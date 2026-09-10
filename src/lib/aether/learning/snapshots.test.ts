import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFeatures, buildMarketStructure, createDecisionSnapshot, htfTrend, priceVsHigh, sparkDistFromHigh, validateNoLookAhead, volatilityRegime } from "./snapshots.ts";
import type { AssetRow } from "../types.ts";
import type { DecisionContext } from "./types.ts";

function makeRanked(opts: Partial<AssetRow> = {}) {
  const base: AssetRow = {
    id: "cg:bitcoin",
    symbol: "BTC",
    name: "Bitcoin",
    kind: "major",
    chainId: null,
    contractAddress: null,
    coingeckoId: "bitcoin",
    imageUrl: null,
    priceUsd: 60_000,
    marketCapUsd: 1_200_000_000_000,
    fdvUsd: null,
    volume24hUsd: 20_000_000_000,
    liquidityUsd: 1_000_000_000,
    change1hPct: 0.5,
    change24hPct: 2.5,
    change7dPct: 5.0,
    pairCreatedAt: null,
    sparkline7d: [50_000, 52_000, 55_000, 58_000, 60_000],
    source: "coingecko",
    sourceReliability: 0.88,
    observedAt: new Date().toISOString(),
    ingestedAt: new Date().toISOString(),
    dataAgeMs: 10_000,
  };
  const asset = Object.assign({}, base, opts);
  return {
    asset,
    score: 0.72,
    confidence: 0.66,
    rugRisk: 0.1,
    components: {
      marketQuality: 0.8,
      liquidity: 0.75,
      momentum: 0.65,
      volumeAnomaly: 0.5,
      smartMoney: 0.2,
      social: 0.1,
      news: 0.0,
      riskPenalty: 0.1,
      executionPenalty: 0.05,
    },
    reasons: ["strong momentum", "healthy liquidity"],
    riskReasons: [],
  };
}

describe("snapshots", () => {
  it("computes distance from 7d high", () => {
    assert.ok(Math.abs(sparkDistFromHigh([50, 60, 55, 62, 58])! - (62 - 58) / 62 * 100) < 0.1);
    assert.equal(sparkDistFromHigh(null), null);
  });

  it("classifies HTF trend from 7d change", () => {
    assert.equal(htfTrend([50, 55, 60], 6), "bullish");
    assert.equal(htfTrend([60, 55, 50], -9), "bearish");
    assert.equal(htfTrend([50, 51, 52], 1), "neutral");
  });

  it("classifies price vs high", () => {
    assert.equal(priceVsHigh(1), "near_high");
    assert.equal(priceVsHigh(25), "near_low");
    assert.equal(priceVsHigh(10), "mid");
  });

  it("classifies volatility regime", () => {
    assert.equal(volatilityRegime(30), "high");
    assert.equal(volatilityRegime(12), "medium");
    assert.equal(volatilityRegime(3), "low");
  });

  it("builds market structure", () => {
    const ms = buildMarketStructure({ sparkline7d: [50_000, 55_000, 60_000], change24hPct: 3, change7dPct: 6 });
    assert.equal(ms.htfTrend, "bullish");
    assert.equal(ms.priceVs7dHigh, "near_high");
    assert.equal(ms.volatilityRegime, "low");
  });

  it("builds decision features", () => {
    const r = makeRanked({ sparkline7d: [60_000, 55_000, 50_000, 58_000, 59_000] });
    const f = buildFeatures({
      score: r.score,
      confidence: r.confidence,
      components: r.components,
      rugRisk: r.rugRisk,
      change1hPct: r.asset.change1hPct,
      change24hPct: r.asset.change24hPct,
      change7dPct: r.asset.change7dPct,
      sparkline7d: r.asset.sparkline7d,
      isMajor: true,
      isDex: false,
    });
    assert.ok(Math.abs(f.momentum - 0.65) < 0.01);
    assert.equal(f.isMajor, true);
    assert.ok(f.distFrom7dHighPct != null && f.distFrom7dHighPct > 0);
  });

  it("creates an immutable decision snapshot", () => {
    const ctx: DecisionContext = {
      assetId: "cg:bitcoin",
      symbol: "BTC",
      decision: "ENTER",
      side: "buy",
      strategyId: "momentum_v2",
      strategyVersion: "2.0.0",
      ranked: makeRanked(),
    };
    const s = createDecisionSnapshot(ctx);
    assert.equal(s.assetId, "cg:bitcoin");
    assert.equal(s.decision, "ENTER");
    assert.equal(s.side, "buy");
    assert.equal(s.strategyId, "momentum_v2");
    assert.ok(s.features.score > 0);
    const originalActionAt = s.actionAt;
    assert.equal(validateNoLookAhead(s, new Date(Date.now() + 1000).toISOString()), true);
    assert.equal(s.actionAt, originalActionAt);
  });

  it("preserves source changes in the machine-readable evidence packet", () => {
    const quiet = makeRanked();
    const active = makeRanked();
    active.components.news = 0.8;
    const base = { assetId: "cg:bitcoin", symbol: "BTC", decision: "ENTER" as const, strategyId: "news", strategyVersion: "1", dataQuality: { priceFresh: true, dataAgeMs: 1_000, sourceReliability: 0.9, source: "coingecko", stalenessFlags: [] } };
    const quietSnapshot = createDecisionSnapshot({ ...base, ranked: quiet });
    const activeSnapshot = createDecisionSnapshot({ ...base, ranked: active });
    assert.equal(quietSnapshot.evidence.newsBoost, 0);
    assert.equal(activeSnapshot.evidence.newsBoost, 0.8);
    const news = activeSnapshot.evidence.items?.find((item) => item.feature === "news");
    assert.equal(news?.source, "news_fusion");
    assert.equal(news?.direction, "positive");
    assert.ok((news?.contribution ?? 0) > 0);
  });

  it("records source conflicts and supplied risk state", () => {
    const riskState = { positionPctOfEquity: 0.02, tokenConcentrationPct: 0.02, chainExposurePct: 0.1, liquidityTakePct: 0.01, slippageBps: 12, dailyLossUsedPct: 0.03, hardLimitsHit: ["daily_loss"] };
    const s = createDecisionSnapshot({
      assetId: "cg:bitcoin", symbol: "BTC", decision: "REJECT", strategyId: "quality", strategyVersion: "1",
      ranked: makeRanked(), riskState,
      dataQuality: { priceFresh: true, dataAgeMs: 1_000, sourceReliability: 0.9, source: "coingecko", stalenessFlags: [], sourceConflict: true },
    });
    assert.ok(s.evidence.contradictorySignals >= 1);
    assert.deepEqual(s.riskState, riskState);
  });

  it("rejects look-ahead snapshots", () => {
    const ctx: DecisionContext = { assetId: "cg:bitcoin", symbol: "BTC", decision: "WAIT", strategyId: "x", strategyVersion: "1" };
    const s = createDecisionSnapshot(ctx);
    assert.equal(validateNoLookAhead(s, new Date(Date.now() - 1000).toISOString()), false);
  });
});
