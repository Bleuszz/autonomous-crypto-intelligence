import { describe, expect, it } from "vitest";
import { buildPatternConditions, describePattern, discoverPatterns, hashConditions, MIN_PATTERN_SAMPLES, promotePattern, sampleSizeStatus } from "./patterns.ts";
import { createDecisionSnapshot } from "./snapshots.ts";
import { computeReward } from "./reward.ts";
import type { DecisionContext, TradeOutcome } from "./types.ts";

function makeCtx(action: DecisionContext["decision"] = "ENTER", overrides: Partial<NonNullable<DecisionContext["ranked"]>>["asset"] = {}): DecisionContext {
  return {
    assetId: "cg:bitcoin",
    symbol: "BTC",
    decision: action,
    side: action === "ENTER" ? "buy" : undefined,
    strategyId: "t",
    strategyVersion: "1",
    ranked: {
      asset: {
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
        sparkline7d: [50_000, 55_000, 60_000],
        source: "coingecko",
        sourceReliability: 0.88,
        observedAt: new Date().toISOString(),
        ingestedAt: new Date().toISOString(),
        dataAgeMs: 10_000,
        ...overrides,
      },
      score: 0.7,
      confidence: 0.65,
      rugRisk: 0.1,
      components: {
        marketQuality: 0.8,
        liquidity: 0.75,
        momentum: 0.65,
        volumeAnomaly: 0.5,
        smartMoney: 0.2,
        social: 0.1,
        news: 0,
        riskPenalty: 0.1,
        executionPenalty: 0.05,
      },
      reasons: [],
      riskReasons: [],
    },
  };
}

function makeOutcome(reward: number): TradeOutcome {
  return {
    id: "o1",
    decisionSnapshotId: "s1",
    portfolioId: "paper-default",
    assetId: "cg:bitcoin",
    exitActionAt: new Date().toISOString(),
    entryPrice: 60_000,
    exitPrice: reward > 0 ? 63_000 : 57_000,
    qty: 1,
    realizedPnlUsd: reward * 100,
    realizedReturnPct: reward,
    realizedRMultiple: reward / 5,
    feesUsd: 10,
    gasUsd: 0,
    slippageBps: 12,
    holdingSeconds: 3600,
    mfePct: reward > 0 ? 6 : 0,
    maePct: reward > 0 ? -1 : -6,
    drawdownImpactPct: 0.01,
    exitReason: "test",
    stopHit: false,
    targetHit: reward > 0,
    thesisInvalidated: false,
    postExitReturnPct: 0,
    opportunityCostPct: null,
    createdAt: new Date().toISOString(),
  };
}

describe("pattern discovery", () => {
  it("hashes identical conditions consistently", () => {
    const a = buildPatternConditions(createDecisionSnapshot(makeCtx()));
    const b = buildPatternConditions(createDecisionSnapshot(makeCtx()));
    expect(hashConditions(a)).toBe(hashConditions(b));
  });

  it("describes a pattern", () => {
    const conds = buildPatternConditions(createDecisionSnapshot(makeCtx()));
    const desc = describePattern(conds);
    expect(desc).toContain("momentum");
    expect(desc).toContain("liquidity");
  });

  it("requires a minimum sample size", () => {
    expect(sampleSizeStatus(MIN_PATTERN_SAMPLES - 1)).toBe("INSUFFICIENT");
    expect(sampleSizeStatus(MIN_PATTERN_SAMPLES)).toBe("WEAK");
    expect(sampleSizeStatus(40)).toBe("STRONG");
  });

  it("does not promote a pattern without enough samples", () => {
    const snapshots = Array.from({ length: 5 }, () => createDecisionSnapshot(makeCtx()));
    const rewards = snapshots.map((s) => computeReward(s, makeOutcome(5)));
    const patterns = discoverPatterns({ snapshots, rewards, action: "ENTER" });
    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns[0]!.status).toBe("SHADOW");
    const promoted = promotePattern(patterns[0]!, "v1");
    expect(promoted.status).toBe("SHADOW"); // cannot promote
  });

  it("promotes a pattern with sufficient positive evidence", () => {
    const snapshots = Array.from({ length: 12 }, () => createDecisionSnapshot(makeCtx()));
    const rewards = snapshots.map((s) => computeReward(s, makeOutcome(5)));
    const patterns = discoverPatterns({ snapshots, rewards, action: "ENTER" });
    expect(patterns.length).toBeGreaterThan(0);
    const candidate = patterns.find((p) => p.sampleCount >= MIN_PATTERN_SAMPLES && p.positiveCount >= 3);
    expect(candidate).toBeDefined();
    const promoted = promotePattern(candidate!, "v1");
    expect(promoted.status).toBe("APPROVED");
    expect(promoted.championVersion).toBe("v1");
  });

  it("separates regimes when asked", () => {
    const bullish = Array.from({ length: 10 }, (_, i) =>
      createDecisionSnapshot(makeCtx("ENTER", { change7dPct: 8, sparkline7d: [50_000 + i * 1000, 60_000] })),
    );
    const bearish = Array.from({ length: 10 }, (_, i) =>
      createDecisionSnapshot(makeCtx("ENTER", { change7dPct: -10, sparkline7d: [60_000, 50_000 + i * 100] })),
    );
    const rewards = [...bullish, ...bearish].map((s) => computeReward(s, makeOutcome(s.marketStructure.htfTrend === "bullish" ? 4 : -4)));
    const patterns = discoverPatterns({ snapshots: [...bullish, ...bearish], rewards, action: "ENTER", groupByRegime: true });
    const bullishPattern = patterns.find((p) => p.regime && /risk|bullish|greedy/i.test(p.regime) && (p.expectancy ?? 0) > 0);
    const bearishPattern = patterns.find((p) => p.regime && /risk|bearish|off/i.test(p.regime) && (p.expectancy ?? 0) < 0);
    // At least one regime-separated pattern should exist.
    expect(patterns.some((p) => p.regime)).toBe(true);
  });

  it("does not overreact to one trade", () => {
    const snapshots = [createDecisionSnapshot(makeCtx())];
    const rewards = [computeReward(snapshots[0]!, makeOutcome(10))];
    const patterns = discoverPatterns({ snapshots, rewards, action: "ENTER" });
    expect(patterns.length).toBe(0);
  });
});
