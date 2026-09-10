import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { alternativeEntries, rejectCounterfactual, remainingEdge, waitOutcome } from "./counterfactual.ts";
import { clusterEvents, clusterConfidenceBoost, jaccard, tokenizeTitle } from "./events-cluster.ts";
import { inferReaction, informationDecay } from "./decay.ts";
import { classifyLifecycle, survivorshipNote } from "./survivorship.ts";
import {
  assignSplit,
  correlationAdjustedCount,
  diversityReport,
  shouldTrainOn,
  type TrainingExperience,
} from "./experiences.ts";
import { assertMonotonic, chronologicalBuckets, detectContamination } from "./splits.ts";
import { pound100Gate } from "./capital-gate.ts";
import { summariseScale, type ScaleTrade } from "../capital.ts";
import { EVIDENCE_TRUST, combineEvidence } from "./evidence.ts";
import { inSampleLuckGuard, wouldReplaceChampion } from "./promotion.ts";
import type { ChampionChallengerMetrics } from "./types.ts";

function exp(over: Partial<TrainingExperience> = {}): TrainingExperience {
  return {
    id: "e1",
    capitalProfile: "research",
    startingEquityGbp: 100_000,
    availableEquityGbp: 80_000,
    positionSizeGbp: 2000,
    portfolioExposurePct: 0.1,
    capitalUtilisationPct: 0.4,
    regime: "Mixed",
    asset: "BTC",
    assetClass: "major",
    marketStructure: "mid",
    signalType: "momentum_v2",
    dataQuality: 80,
    sourceConflict: false,
    eventClusterId: null,
    decisionTimestamp: new Date().toISOString(),
    latestMarketDataTimestamp: new Date().toISOString(),
    latestNewsTimestamp: null,
    latestSocialTimestamp: null,
    latestEventTimestamp: null,
    analysisTimestamp: new Date().toISOString(),
    decision: "ENTER",
    confidence: 0.6,
    executableAt100: false,
    minimumRequiredCapitalGbp: 400,
    capitalSensitivity: "UNKNOWN",
    outcome: "open",
    reward: 0.2,
    learningWeight: 0.8,
    split: "TRAINING",
    usedForTraining: true,
    correlationGroup: "btc:Mixed",
    lookaheadClean: true,
    negativeExample: false,
    historicalReplay: false,
    assetState: "ACTIVE",
    ...over,
  };
}

describe("WAIT / REJECT counterfactuals", () => {
  it("treats WAIT followed by a dump as a correct stand-aside", () => {
    const t0 = 1_000_000;
    const path = [
      { t: t0, px: 100 },
      { t: t0 + 60_000, px: 99 },
      { t: t0 + 3_600_000, px: 92 },
    ];
    const w = waitOutcome({ path, decisionT: t0, holdMs: 4 * 3600_000 });
    assert.equal(w.kind, "WAIT");
    assert.ok((w.pnlPct ?? 0) < 0);
    assert.ok((w.avoidedLossPct ?? 0) > 0);
    assert.match(w.notes, /correct/i);
  });

  it("records opportunity cost when WAIT missed a rally", () => {
    const t0 = 1_000_000;
    const path = [
      { t: t0, px: 100 },
      { t: t0 + 60_000, px: 104 },
      { t: t0 + 3_600_000, px: 112 },
    ];
    const w = waitOutcome({ path, decisionT: t0 });
    assert.ok((w.opportunityCostPct ?? 0) > 0);
    assert.match(w.notes, /conservative/i);
  });

  it("builds REJECT counterfactuals from the same path", () => {
    const t0 = 1_000_000;
    const path = [{ t: t0, px: 10 }, { t: t0 + 120_000, px: 8 }];
    const r = rejectCounterfactual({ path, decisionT: t0, holdMs: 200_000 });
    assert.equal(r.kind, "REJECT");
    assert.match(r.notes, /prevented|blocked|INSUFFICIENT|loss/i);
  });

  it("measures alternative entry timings and decay", () => {
    const t0 = 1_000_000;
    const path = [];
    for (let i = 0; i < 40; i++) path.push({ t: t0 + i * 60_000, px: 100 + i * 0.2 });
    const alts = alternativeEntries({ path, decisionT: t0, holdMs: 20 * 60_000, barMs: 60_000 });
    assert.equal(alts.length, 6);
    const edge = remainingEdge(alts);
    assert.ok(edge.bestLabel);
  });
});

describe("event clustering", () => {
  it("maps the same story from X and RSS onto one cluster", () => {
    const t = Date.now();
    const clusters = clusterEvents([
      { id: "x1", title: "SEC approves spot bitcoin ETF", source: "x", publishedAt: t, observedAt: t, affectedAssets: ["BTC"] },
      { id: "n1", title: "Spot bitcoin ETF approved by the SEC", source: "coindesk", publishedAt: t + 120_000, observedAt: t + 120_000, affectedAssets: ["BTC"] },
      { id: "n2", title: "Solana outage on mainnet", source: "reddit", publishedAt: t, observedAt: t, affectedAssets: ["SOL"] },
    ]);
    const btc = clusters.find((c) => c.memberIds.includes("x1"));
    assert.ok(btc);
    assert.equal(btc!.memberIds.length, 2);
    assert.equal(btc!.independentSourceCount, 2);
    assert.ok(clusterConfidenceBoost(btc!) > 0);
    assert.ok(jaccard(tokenizeTitle("SEC approves spot bitcoin ETF"), tokenizeTitle("Spot bitcoin ETF approved by the SEC")) > 0.4);
  });
});

describe("information decay", () => {
  it("reports little remaining edge when the move already printed", () => {
    const t0 = 1_000;
    const d = informationDecay({
      publishedAt: t0,
      detectedAt: t0 + 10 * 60_000,
      analysisAt: t0 + 11 * 60_000,
      marketReactionStart: t0 + 30_000,
      marketReactionPeak: t0 + 2 * 60_000,
      priceAtPublish: 100,
      priceAtDetect: 108,
      priceAtPeak: 108.2,
      falsePositive: false,
    });
    assert.ok((d.remainingEdgeFraction ?? 1) < 0.2);
    assert.match(d.notes, /Little remaining edge/i);
  });

  it("infers false positives when the tape never reacts", () => {
    const t0 = 5_000;
    const r = inferReaction({
      publishedAt: t0,
      path: [
        { t: t0, px: 50 },
        { t: t0 + 60_000, px: 50.05 },
        { t: t0 + 120_000, px: 49.97 },
      ],
    });
    assert.equal(r.falsePositive, true);
  });
});

describe("survivorship", () => {
  it("never deletes rugged or delisted assets", () => {
    const rugged = classifyLifecycle({ lastObservedAt: Date.now(), priceUsd: 0.0000001, rugRisk: 0.9 });
    assert.equal(rugged.state, "RUGGED");
    assert.equal(rugged.retainHistory, true);
    const dead = classifyLifecycle({ lastObservedAt: Date.now() - 20 * 24 * 3600_000, priceUsd: 1e-12 });
    assert.ok(["FAILED", "UNKNOWN"].includes(dead.state));
    const note = survivorshipNote(["ACTIVE", "ACTIVE", "ACTIVE"]);
    assert.match(note, /Survivorship bias/);
  });
});

describe("splits and contamination", () => {
  it("assigns later timestamps to held-out splits", () => {
    const start = 0;
    const end = 100;
    assert.equal(assignSplit(10, { start, end }), "TRAINING");
    assert.equal(assignSplit(90, { start, end }), "WALK_FORWARD");
  });

  it("refuses to train on OOS or lookahead-dirty rows", () => {
    const dirty = shouldTrainOn(exp({ lookaheadClean: false }));
    assert.equal(dirty.ok, false);
    const oos = shouldTrainOn(exp({ split: "OOS" }));
    assert.equal(oos.ok, false);
    const ok = shouldTrainOn(exp());
    assert.equal(ok.ok, true);
  });

  it("detects train/OOS contamination", () => {
    const map = new Map<string, Array<"TRAINING" | "OOS">>([["x", ["TRAINING", "OOS"]]]);
    const c = detectContamination(map);
    assert.equal(c.ok, false);
    const rows = chronologicalBuckets([
      { t: 1, id: "a" },
      { t: 2, id: "b" },
      { t: 3, id: "c" },
      { t: 4, id: "d" },
      { t: 5, id: "e" },
      { t: 6, id: "f" },
      { t: 7, id: "g" },
      { t: 8, id: "h" },
      { t: 9, id: "i" },
      { t: 10, id: "j" },
    ]);
    assert.ok(rows.training.length);
    assert.ok(rows.oos.length + rows.walkForward.length);
    assert.equal(assertMonotonic([{ t: 1, id: "a" }, { t: 2, id: "b" }]).ok, true);
  });

  it("down-counts correlated BTC/ETH/alt copies", () => {
    const n = correlationAdjustedCount([
      { correlationGroup: "btc:Mixed" },
      { correlationGroup: "btc:Mixed" },
      { correlationGroup: "btc:Mixed" },
      { correlationGroup: "eth:Mixed" },
    ]);
    assert.ok(n < 4);
  });

  it("tracks WAIT/REJECT/negative diversity", () => {
    const d = diversityReport([
      exp(),
      exp({ id: "e2", decision: "WAIT", negativeExample: true, asset: "ETH" }),
      exp({ id: "e3", decision: "REJECT", historicalReplay: true, asset: "SOL", regime: "Risk-off" }),
    ]);
    assert.equal(d.wait, 1);
    assert.equal(d.reject, 1);
    assert.equal(d.negative, 1);
    assert.equal(d.uniqueAssets, 3);
  });
});

describe("£100 deployment gate", () => {
  it("refuses promotion when £100 cannot trade", () => {
    const empty: ScaleTrade[] = [{ returnPct: 0, pnlGbp: 0, feesGbp: 0, slippageBps: 0, notionalGbp: 0, rejected: true }];
    const rich: ScaleTrade[] = [];
    for (let i = 0; i < 12; i++) rich.push({ returnPct: 1, pnlGbp: 80, feesGbp: 1, slippageBps: 8, notionalGbp: 2000, rejected: false });
    const gate = pound100Gate([summariseScale(100, empty), summariseScale(100_000, rich)]);
    assert.equal(gate.ready, false);
    assert.equal(gate.label, "NOT DEPLOYMENT READY");
  });
});

describe("evidence trust", () => {
  it("down-weights X relative to events and verified wallets", () => {
    assert.ok(EVIDENCE_TRUST.x < EVIDENCE_TRUST.event);
    assert.ok(EVIDENCE_TRUST.x < EVIDENCE_TRUST.wallet_verified);
    assert.ok(EVIDENCE_TRUST.news_untimestamped === 0);
    const mixed = combineEvidence([
      { kind: "event", clusterId: "c1", source: "rss" },
      { kind: "x", clusterId: "c1", source: "x" },
    ]);
    assert.equal(mixed.xDownweighted, true);
    assert.ok(mixed.weight < 1.3);
  });
});

describe("champion luck guard", () => {
  it("will not replace the champion because an in-sample backtest looks good", () => {
    const luck = inSampleLuckGuard({
      inSampleExpectancy: 1.8,
      oosExpectancy: 0.05,
      inSampleSharpe: 2.4,
      oosSharpe: 0.05,
      uniqueDays: 8,
    });
    assert.equal(luck.ok, false);
    const challenger: ChampionChallengerMetrics = {
      totalReturnPct: 80,
      sharpe: 2.5,
      maxDrawdownPct: 4,
      winRate: 0.9,
      expectancy: 1.8,
      calmar: 4,
      payoffRatio: 3,
      nTrades: 12,
      tradesByRegime: {},
      tradesByAsset: {},
      costSensitivity: {},
      oosExpectancy: -0.2,
      oosSharpe: -0.1,
      capitalClassification: "CAPITAL-DEPENDENT",
    };
    const champion: ChampionChallengerMetrics = {
      totalReturnPct: 6,
      sharpe: 0.8,
      maxDrawdownPct: 7,
      winRate: 0.48,
      expectancy: 0.2,
      calmar: 0.7,
      payoffRatio: 1.2,
      nTrades: 40,
      tradesByRegime: {},
      tradesByAsset: {},
      costSensitivity: {},
      oosExpectancy: 0.15,
      oosSharpe: 0.6,
    };
    const replace = wouldReplaceChampion({ challenger, champion, uniqueDays: 8 });
    assert.equal(replace.replace, false);
  });
});
