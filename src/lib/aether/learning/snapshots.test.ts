import { describe, expect, it } from "vitest";
import { buildFeatures, buildMarketStructure, createDecisionSnapshot, htfTrend, priceVsHigh, sparkDistFromHigh, validateNoLookAhead, volatilityRegime } from "./snapshots.ts";
import type { DecisionContext, DecisionSnapshot } from "./types.ts";

function makeRanked(opts: Partial<NonNullable<DecisionContext["ranked"]>>["asset"] = {}) {
  const asset = {
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
    ...opts,
  };
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
    expect(sparkDistFromHigh([50, 60, 55, 62, 58])).toBeCloseTo((62 - 58) / 62 * 100, 1);
    expect(sparkDistFromHigh(null)).toBeNull();
  });

  it("classifies HTF trend from 7d change", () => {
    expect(htfTrend([50, 55, 60], 6)).toBe("bullish");
    expect(htfTrend([60, 55, 50], -9)).toBe("bearish");
    expect(htfTrend([50, 51, 52], 1)).toBe("neutral");
  });

  it("classifies price vs high", () => {
    expect(priceVsHigh(1)).toBe("near_high");
    expect(priceVsHigh(25)).toBe("near_low");
    expect(priceVsHigh(10)).toBe("mid");
  });

  it("classifies volatility regime", () => {
    expect(volatilityRegime(30)).toBe("high");
    expect(volatilityRegime(12)).toBe("medium");
    expect(volatilityRegime(3)).toBe("low");
  });

  it("builds market structure", () => {
    const ms = buildMarketStructure({ sparkline7d: [50_000, 55_000, 60_000], change24hPct: 3, change7dPct: 6 });
    expect(ms.htfTrend).toBe("bullish");
    expect(ms.priceVs7dHigh).toBe("near_high");
    expect(ms.volatilityRegime).toBe("low");
  });

  it("builds decision features", () => {
    const r = makeRanked();
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
    expect(f.momentum).toBeCloseTo(0.65, 2);
    expect(f.isMajor).toBe(true);
    expect(f.distFrom7dHighPct).toBeGreaterThan(0);
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
    expect(s.assetId).toBe("cg:bitcoin");
    expect(s.decision).toBe("ENTER");
    expect(s.side).toBe("buy");
    expect(s.strategyId).toBe("momentum_v2");
    expect(s.features.score).toBeGreaterThan(0);
    // Snapshot must not be mutated by later outcome changes.
    const originalActionAt = s.actionAt;
    expect(validateNoLookAhead(s, new Date(Date.now() + 1000).toISOString())).toBe(true);
    expect(s.actionAt).toBe(originalActionAt);
  });

  it("rejects look-ahead snapshots", () => {
    const ctx: DecisionContext = { assetId: "cg:bitcoin", symbol: "BTC", decision: "WAIT", strategyId: "x", strategyVersion: "1" };
    const s = createDecisionSnapshot(ctx);
    // Outcome time before decision time should be invalid.
    expect(validateNoLookAhead(s, new Date(Date.now() - 1000).toISOString())).toBe(false);
  });
});
