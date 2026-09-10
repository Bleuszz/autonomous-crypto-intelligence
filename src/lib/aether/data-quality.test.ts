import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assessDataQuality,
  DATA_QUALITY_MIN_ENTRY,
  detectFakeMove,
  freshnessScore,
  sourceAgreementScore,
  type DataQualityInput,
} from "./data-quality.ts";

function base(over: Partial<DataQualityInput> = {}): DataQualityInput {
  const now = Date.now();
  return {
    assetId: "cg:bitcoin",
    symbol: "BTC",
    kind: "major",
    primaryPriceUsd: 100,
    primarySource: "coingecko",
    primaryObservedAt: new Date(now - 20_000).toISOString(),
    dataAgeMs: 20_000,
    volume24hUsd: 20_000_000_000,
    liquidityUsd: 5_000_000_000,
    change1hPct: 0.2,
    change24hPct: 1.1,
    quotes: [
      { source: "kraken", priceUsd: 100.02, observedAt: new Date(now - 5_000).toISOString() },
      { source: "coinbase", priceUsd: 99.98, observedAt: new Date(now - 6_000).toISOString() },
      { source: "coingecko", priceUsd: 100, observedAt: new Date(now - 20_000).toISOString() },
    ],
    nowMs: now,
    ...over,
  };
}

describe("data quality", () => {
  it("scores agreed fresh majors highly and does not block entry", () => {
    const q = assessDataQuality(base());
    assert.ok(q.score >= 65, `score ${q.score}`);
    assert.equal(q.sourceConflict, false);
    assert.equal(q.blockEntry, false);
    assert.equal(q.delayed, false);
  });

  it("flags source disagreement instead of silently averaging", () => {
    const now = Date.now();
    const ag = sourceAgreementScore(
      [
        { source: "kraken", priceUsd: 100, observedAt: new Date(now).toISOString() },
        { source: "okx", priceUsd: 108, observedAt: new Date(now).toISOString() },
      ],
      "major",
    );
    assert.ok(ag.conflict);
    assert.equal(ag.conflict?.conflictType, "price_disagreement");
    assert.ok((ag.spreadBps ?? 0) > 50);
  });

  it("penalises delayed and stale marks", () => {
    const delayed = freshnessScore(4 * 60_000);
    assert.equal(delayed.delayed, true);
    assert.equal(delayed.stale, false);
    const stale = freshnessScore(20 * 60_000);
    assert.equal(stale.stale, true);
    assert.ok(stale.stalePenalty > delayed.delayedPenalty);
  });

  it("blocks stale data from paper entries", () => {
    const q = assessDataQuality(base({ dataAgeMs: 30 * 60_000, quotes: [] }));
    assert.equal(q.stale, true);
    assert.equal(q.blockEntry, true);
    assert.match(q.blockReason ?? "", /stale/i);
  });

  it("detects unconfirmed vertical prints as fake-move candidates", () => {
    const fake = detectFakeMove(
      base({
        kind: "dex",
        change1hPct: 22,
        change24hPct: 40,
        liquidityUsd: 80_000,
        volume24hUsd: 2_000_000,
        quotes: [{ source: "dexscreener", priceUsd: 1, observedAt: new Date().toISOString() }],
      }),
      20,
      1,
    );
    assert.equal(fake.fakeMove, true);
    assert.ok(fake.penalty > 0);
  });

  it("down-weights wash-like volume with no confirmation", () => {
    const fake = detectFakeMove(
      base({
        kind: "dex",
        change1hPct: 0.1,
        liquidityUsd: 20_000,
        volume24hUsd: 1_000_000,
        quotes: [{ source: "dexscreener", priceUsd: 1, observedAt: new Date().toISOString() }],
      }),
      20,
      1,
    );
    assert.equal(fake.wash, true);
  });

  it("gives low learning weight to bad data rather than treating it as truth", () => {
    const q = assessDataQuality(
      base({
        dataAgeMs: 40 * 60_000,
        quotes: [
          { source: "a", priceUsd: 1, observedAt: new Date().toISOString() },
          { source: "b", priceUsd: 2, observedAt: new Date().toISOString() },
        ],
        kind: "dex",
        change1hPct: 30,
        liquidityUsd: 12_000,
      }),
    );
    assert.ok(q.learningWeight < 0.5);
    assert.ok(q.score < DATA_QUALITY_MIN_ENTRY);
  });

  it("rejects missing prices instead of inventing them", () => {
    const q = assessDataQuality(
      base({
        primaryPriceUsd: 0,
        quotes: [],
        volume24hUsd: null,
        liquidityUsd: null,
      }),
    );
    assert.equal(q.score, 0);
    assert.equal(q.blockEntry, true);
    assert.match(q.blockReason ?? "", /DATA UNAVAILABLE|missing/i);
    assert.equal(q.learningWeight, 0);
    assert.ok(q.flags.includes("missing_price"));
  });

  it("confirms news only when the tape moves with it", () => {
    const now = Date.now();
    const q = assessDataQuality(
      base({
        news: [{ publishedAt: new Date(now - 10 * 60_000).toISOString(), title: "Spot ETF approved for bitcoin" }],
        change1hPct: 1.2,
        change24hPct: 3,
        nowMs: now,
      }),
    );
    assert.equal(q.newsConfirmed, true);
  });
});
