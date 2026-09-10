import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDecisionSnapshot } from "./snapshots.ts";
import { computeReward } from "./reward.ts";
import { discoverPatterns } from "./patterns.ts";
import { createLearnerVersion, DEFAULT_LEARNER_VERSION, estimateExpectedReward, recommendAction } from "./learner.ts";
import type { AssetRow } from "../types.ts";
import type { DecisionContext, TradeOutcome } from "./types.ts";

function baseAsset(): AssetRow {
  return {
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
}

function makeCtx(action: DecisionContext["decision"] = "ENTER", assetOverrides: Partial<AssetRow> = {}): DecisionContext {
  const asset = { ...baseAsset(), ...assetOverrides };
  return {
    assetId: asset.id,
    symbol: asset.symbol,
    decision: action,
    side: action === "ENTER" ? "buy" : undefined,
    strategyId: "t",
    strategyVersion: "1",
    ranked: {
      asset,
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

describe("contextual learner", () => {
  it("starts in shadow mode", () => {
    const learner = createLearnerVersion({ version: DEFAULT_LEARNER_VERSION, strategyId: "ensemble", strategyVersion: "1.0.0" });
    assert.equal(learner.status, "SHADOW");
    assert.equal(learner.learnerVersion, DEFAULT_LEARNER_VERSION);
  });

  it("returns zero expectation when no patterns exist", () => {
    const snapshot = createDecisionSnapshot(makeCtx());
    const rec = estimateExpectedReward({ snapshot, action: "ENTER", patterns: [] });
    assert.equal(rec.expectedReward, 0);
    assert.equal(rec.confidence, 0);
  });

  it("recommends the action with highest expected reward", () => {
    const snapshots = Array.from({ length: 15 }, () => createDecisionSnapshot(makeCtx()));
    const rewards = snapshots.map((s) => computeReward(s, makeOutcome(5)));
    const patterns = discoverPatterns({ snapshots, rewards, action: "ENTER" });
    assert.ok(patterns.length > 0);

    const rec = recommendAction({ snapshot: createDecisionSnapshot(makeCtx()), patterns });
    assert.ok(["ENTER", "WAIT", "REJECT"].includes(rec.action));
    assert.ok(rec.expectedReward >= -1);
    assert.ok(rec.confidence >= 0);
    assert.ok(rec.reasons.length > 0);
  });

  it("weights recent patterns more heavily", () => {
    const now = Date.now();
    const oldPattern = {
      id: "p-old",
      patternHash: "h",
      status: "APPROVED" as const,
      description: "old",
      conditions: { momentumBand: "high", liquidityBand: "high" },
      action: "ENTER" as const,
      regime: null,
      assetScope: null,
      sampleCount: 10,
      positiveCount: 7,
      negativeCount: 3,
      winRate: 0.7,
      expectancy: 0.5,
      avgReward: 0.5,
      rewardVariance: 0.1,
      confidenceLower: 0.3,
      confidenceUpper: 0.7,
      oosExpectancy: 0.4,
      walkForwardStability: 0.8,
      recencyWeight: 0.2,
      firstSeenAt: new Date(now - 60 * 24 * 3600 * 1000).toISOString(),
      lastSeenAt: new Date(now - 60 * 24 * 3600 * 1000).toISOString(),
      promotedAt: null,
      rolledBackAt: null,
      championVersion: null,
      learnerVersion: DEFAULT_LEARNER_VERSION,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const newPattern = { ...oldPattern, id: "p-new", expectancy: 0.2, lastSeenAt: new Date(now).toISOString(), firstSeenAt: new Date(now).toISOString() };
    const snapshot = createDecisionSnapshot(makeCtx());
    snapshot.features.momentum = 0.8;
    snapshot.features.liquidity = 0.8;
    const recNew = estimateExpectedReward({ snapshot, action: "ENTER", patterns: [newPattern], recencyDecayDays: 30 });
    const recOld = estimateExpectedReward({ snapshot, action: "ENTER", patterns: [oldPattern], recencyDecayDays: 30 });
    assert.ok(recNew.expectedReward > recOld.expectedReward);
  });

  it("does not issue arbitrary confidence scores", () => {
    const snapshots = Array.from({ length: 15 }, () => createDecisionSnapshot(makeCtx()));
    const rewards = snapshots.map((s) => computeReward(s, makeOutcome(5)));
    const patterns = discoverPatterns({ snapshots, rewards, action: "ENTER" });
    const rec = recommendAction({ snapshot: createDecisionSnapshot(makeCtx()), patterns });
    assert.ok(rec.confidence <= 1);
    assert.ok(rec.confidence >= 0);
  });
});
