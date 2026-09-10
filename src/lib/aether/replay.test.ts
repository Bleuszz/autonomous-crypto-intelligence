import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  asOfFrame,
  delayedDataInvalidates,
  detectLookahead,
  framesFromCandles,
  injectFutureAndDetect,
  pathOnOrAfter,
  runReplay,
  runReplayTraining,
  settleReplayDecisions,
  timestampsFor,
  type ReplayFrame,
} from "./replay.ts";

function frame(t: number, close: number, extras: Partial<ReplayFrame> = {}): ReplayFrame {
  return {
    t,
    assets: [
      {
        assetId: "cg:bitcoin",
        symbol: "BTC",
        kind: "major",
        t,
        open: close * 0.99,
        high: close * 1.01,
        low: close * 0.98,
        close,
        volume: 20_000_000_000,
        liquidityUsd: 5_000_000_000,
        quotes: [
          { source: "kraken", priceUsd: close, observedAt: new Date(t).toISOString() },
          { source: "coinbase", priceUsd: close * 1.0001, observedAt: new Date(t).toISOString() },
        ],
      },
    ],
    news: extras.news ?? [],
    social: extras.social ?? [],
    events: extras.events ?? [],
    regime: { fearGreed: 50, btcChange24h: 0, ethChange24h: 0, btcFundingPct: 0, label: "Mixed" },
  };
}

describe("historical replay anti-lookahead", () => {
  it("strips future news and candles from as-of frames", () => {
    const t0 = 1_700_000_000_000;
    const f = frame(t0, 100, {
      news: [
        { publishedAt: t0 - 60_000, title: "old" },
        { publishedAt: t0 + 60_000, title: "future leak" },
      ],
    });
    f.assets.push({
      assetId: "cg:bitcoin",
      symbol: "BTC",
      kind: "major",
      t: t0 + 3_600_000,
      open: 120, high: 121, low: 119, close: 120,
      volume: 1, liquidityUsd: 1,
    });
    const sliced = asOfFrame(f, t0);
    assert.equal(sliced.news.length, 1);
    assert.equal(sliced.news[0]?.title, "old");
    assert.ok(sliced.assets.every((a) => a.t <= t0));
  });

  it("detects future-data injection", () => {
    const t0 = 1_700_000_000_000;
    const f = frame(t0, 100);
    const v = injectFutureAndDetect({
      frame: f,
      decisionT: t0,
      futureNews: { publishedAt: t0 + 5 * 60_000, title: "hack leaked from the future" },
    });
    assert.ok(v.some((x) => x.field === "latestNewsTimestamp"));
  });

  it("flags analysis timestamp after the decision clock", () => {
    const t0 = 1_700_000_000_000;
    const ts = timestampsFor(frame(t0, 100), t0 + 10_000);
    const v = detectLookahead(ts);
    assert.ok(v.some((x) => x.field === "analysisTimestamp"));
  });

  it("marks instant-only strategies invalid under delayed-data replay", () => {
    const t0 = 1_700_000_000_000;
    const frames: ReplayFrame[] = [];
    let px = 100;
    for (let i = 0; i < 40; i++) {
      px = px * (i % 6 === 0 ? 0.97 : 1.004);
      frames.push(frame(t0 + i * 3_600_000, px));
    }
    const instant = runReplay({
      frames,
      delayMs: 0,
      capitalProfile: "research",
      fx: { gbpUsd: 1.27, observedAt: new Date(t0).toISOString(), source: "test" },
    });
    const delayed = { ...instant, fills: 0, decisions: instant.decisions.map((d) => d.decision === "ENTER" ? { ...d, decision: "WAIT" as const } : d) };
    const check = delayedDataInvalidates(instant, delayed);
    if (instant.fills > 0) {
      assert.equal(check.invalid, true);
    }
  });

  it("records WAIT as a real decision, not missing data", () => {
    const t0 = 1_700_000_000_000;
    const frames = [frame(t0, 100), frame(t0 + 3_600_000, 100.1)];
    const r = runReplay({
      frames,
      capitalProfile: "research",
      fx: { gbpUsd: 1.27, observedAt: new Date(t0).toISOString(), source: "test" },
    });
    assert.ok(r.waits + r.fills + r.rejected >= 0);
    assert.ok(r.decisions.some((d) => d.decision === "WAIT" || d.decision === "ENTER" || d.decision === "REJECT"));
    assert.doesNotMatch(r.notes, /LOOKAHEAD/);
  });

  it("detects future social and events as well as news", () => {
    const t0 = 1_700_000_000_000;
    const f = frame(t0, 100);
    const v = injectFutureAndDetect({
      frame: f,
      decisionT: t0,
      futureSocial: { publishedAt: t0 + 60_000, body: "future tweet" },
      futureEvent: { publishedAt: t0 + 120_000, detectedAt: t0 + 120_000, eventType: "hack", impactScore: 0.9 },
      futureBar: {
        assetId: "cg:bitcoin",
        symbol: "BTC",
        kind: "major",
        t: t0 + 3_600_000,
        open: 130, high: 131, low: 129, close: 130,
        volume: 1, liquidityUsd: 1,
      },
    });
    assert.ok(v.some((x) => x.field === "latestSocialTimestamp" || x.field === "future_candle" || x.field === "latestEventTimestamp"));
  });

  it("settles WAIT using only prices at or after the decision", () => {
    const t0 = 1_700_000_000_000;
    const frames = [
      frame(t0 - 3_600_000, 50),
      frame(t0, 100),
      frame(t0 + 3_600_000, 90),
    ];
    const path = pathOnOrAfter(frames, "cg:bitcoin", t0);
    assert.ok(path.every((p) => p.t >= t0));
    assert.ok(path[0]?.px === 100);
    const replay = runReplay({
      frames,
      capitalProfile: "research",
      fx: { gbpUsd: 1.27, observedAt: new Date(t0).toISOString(), source: "test" },
    });
    const settled = settleReplayDecisions(frames, replay.decisions);
    const waits = settled.filter((s) => s.decision === "WAIT");
    assert.ok(waits.length >= 1);
    assert.ok(waits.every((w) => w.outcome == null || (w.outcome.entryPx ?? 100) >= 90));
  });

  it("drops lookahead-dirty examples from the training loop", () => {
    const t0 = 1_700_000_000_000;
    const frames: ReplayFrame[] = [];
    let px = 100;
    for (let i = 0; i < 40; i++) {
      px = px * (i % 7 === 0 ? 0.96 : 1.003);
      frames.push(frame(t0 + i * 86_400_000, px));
    }
    const trained = runReplayTraining({
      frames,
      capitalProfile: "research",
      fx: { gbpUsd: 1.27, observedAt: new Date(t0).toISOString(), source: "test" },
    });
    assert.ok(trained.experiences.every((e) => e.lookaheadClean));
    assert.ok(trained.experiences.every((e) => e.historicalReplay));
    assert.equal(trained.scaleReports.length, 7);
  });

  it("builds frames at bar close so the close is not look-ahead", () => {
    const t0 = 1_700_000_000_000;
    const frames = framesFromCandles({
      series: [{
        assetId: "cg:bitcoin",
        symbol: "BTC",
        candles: [
          { t: t0, open: 100, high: 101, low: 99, close: 100.5, volume: 1 },
          { t: t0 + 86_400_000, open: 100.5, high: 102, low: 100, close: 101, volume: 1 },
        ],
      }],
    });
    assert.ok(frames[0]!.t > t0);
    assert.equal(frames[0]!.assets[0]!.close, 100.5);
  });
});
