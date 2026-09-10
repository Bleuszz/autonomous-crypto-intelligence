import { describe, expect, it } from "vitest";
import { computeReward } from "./reward.ts";
import { createDecisionSnapshot } from "./snapshots.ts";
import type { DecisionContext, TradeOutcome } from "./types.ts";

function makeSnapshot(decision: DecisionContext["decision"] = "ENTER", side: "buy" | "sell" = "buy", overrides: Partial<NonNullable<DecisionContext["ranked"]>> = {}) {
  const ranked = {
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
      ...overrides.asset,
    },
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
    reasons: ["strong momentum"],
    riskReasons: [],
    ...overrides,
  };
  return createDecisionSnapshot({ assetId: ranked.asset.id, symbol: ranked.asset.symbol, decision, side, strategyId: "t", strategyVersion: "1", ranked });
}

function makeOutcome(opts: Partial<TradeOutcome> = {}): TradeOutcome {
  return {
    id: "o1",
    decisionSnapshotId: "s1",
    portfolioId: "paper-default",
    assetId: "cg:bitcoin",
    exitActionAt: new Date().toISOString(),
    entryPrice: 60_000,
    exitPrice: 63_000,
    qty: 1,
    realizedPnlUsd: 3000,
    realizedReturnPct: 5,
    realizedRMultiple: 1.0,
    feesUsd: 50,
    gasUsd: 0,
    slippageBps: 12,
    holdingSeconds: 3600,
    mfePct: 6,
    maePct: -1,
    drawdownImpactPct: 0.01,
    exitReason: "take profit",
    stopHit: false,
    targetHit: true,
    thesisInvalidated: false,
    postExitReturnPct: -0.5,
    opportunityCostPct: null,
    createdAt: new Date().toISOString(),
    ...opts,
  };
}

describe("reward engine", () => {
  it("rewards a positive outcome with good decision quality", () => {
    const snap = makeSnapshot();
    const out = makeOutcome();
    const reward = computeReward(snap, out);
    expect(reward.totalReward).toBeGreaterThan(0);
    expect(reward.components.outcomeQuality).toBeGreaterThan(0);
    expect(reward.components.decisionQuality).toBeGreaterThan(0);
    expect(reward.decisionOutcomeClass).toBe("GOOD_GOOD");
    expect(reward.avoidableLoss).toBeNull();
  });

  it("penalizes a losing outcome", () => {
    const snap = makeSnapshot();
    const out = makeOutcome({ exitPrice: 57_000, realizedReturnPct: -5, realizedPnlUsd: -3000, maePct: -6 });
    const reward = computeReward(snap, out);
    expect(reward.totalReward).toBeLessThan(0);
    expect(reward.components.outcomeQuality).toBeLessThan(0);
  });

  it("marks avoidable losses when evidence is weak", () => {
    const snap = makeSnapshot("ENTER", "buy", {
      asset: { change7dPct: -15, change24hPct: -5 },
      components: { momentum: 0.3, liquidity: 0.2, volumeAnomaly: 0.1 },
    });
    const out = makeOutcome({ exitPrice: 57_000, realizedReturnPct: -5, maePct: -8 });
    const reward = computeReward(snap, out);
    expect(reward.avoidableLoss).toBe("AVOIDABLE");
  });

  it("does not mark a positive trade as avoidable loss", () => {
    const snap = makeSnapshot();
    const out = makeOutcome();
    const reward = computeReward(snap, out);
    expect(reward.avoidableLoss).toBeNull();
  });

  it("classifies bad decision / good outcome", () => {
    const snap = makeSnapshot("ENTER", "buy", { score: 0.3, confidence: 0.3 });
    const out = makeOutcome();
    const reward = computeReward(snap, out);
    expect(reward.decisionOutcomeClass).toBe("BAD_GOOD");
  });

  it("penalizes excessive slippage and fees", () => {
    const snap = makeSnapshot();
    const out = makeOutcome({ slippageBps: 250, feesUsd: 500, realizedPnlUsd: 200 });
    const reward = computeReward(snap, out);
    expect(reward.components.slippagePenalty).toBeLessThan(0);
    expect(reward.components.feePenalty).toBeLessThan(0);
  });

  it("penalizes contradiction with bearish HTF trend", () => {
    const snap = makeSnapshot("ENTER", "buy", { asset: { change7dPct: -20, sparkline7d: [60_000, 55_000, 50_000] } });
    const out = makeOutcome();
    const reward = computeReward(snap, out);
    expect(reward.components.contradictionPenalty).toBeLessThan(0);
  });

  it("is deterministic for identical inputs", () => {
    const snap = makeSnapshot();
    const out = makeOutcome();
    const a = computeReward(snap, out);
    const b = computeReward(snap, out);
    expect(a.totalReward).toBe(b.totalReward);
    expect(a.components).toEqual(b.components);
  });
});
