import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeReward } from "./reward.ts";
import { createDecisionSnapshot } from "./snapshots.ts";
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

function makeSnapshot(decision: DecisionContext["decision"] = "ENTER", side: "buy" | "sell" = "buy", assetOverrides: Partial<AssetRow> = {}, score = 0.72, confidence = 0.66) {
  const asset = { ...baseAsset(), ...assetOverrides };
  const ranked = {
    asset,
    score,
    confidence,
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
  };
  return createDecisionSnapshot({ assetId: asset.id, symbol: asset.symbol, decision, side, strategyId: "t", strategyVersion: "1", ranked });
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
    realizedRMultiple: null,
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
    assert.ok(reward.totalReward > 0);
    assert.ok(reward.components.outcomeQuality > 0);
    assert.ok(reward.components.decisionQuality > 0);
    assert.equal(reward.decisionOutcomeClass, "GOOD_GOOD");
    assert.equal(reward.avoidableLoss, null);
  });

  it("penalizes a losing outcome", () => {
    const snap = makeSnapshot();
    const out = makeOutcome({ exitPrice: 57_000, realizedReturnPct: -5, realizedPnlUsd: -3000, maePct: -6 });
    const reward = computeReward(snap, out);
    assert.ok(reward.totalReward < 0);
    assert.ok(reward.components.outcomeQuality < 0);
  });

  it("uses the later outcome prices, not the contemporaneous mark", () => {
    const snap = makeSnapshot("ENTER", "buy", { priceUsd: 60_000, change1hPct: 8, change24hPct: 12 });
    const laterLoss = makeOutcome({
      entryPrice: 60_000,
      exitPrice: 52_000,
      realizedReturnPct: -13.3,
      realizedPnlUsd: -8000,
      maePct: -14,
      mfePct: 0.4,
      holdingSeconds: 8 * 3600,
    });
    const reward = computeReward(snap, laterLoss);
    assert.ok(reward.totalReward < 0, "a later dump must not be scored as a win just because the print looked green at signal time");
  });

  it("marks avoidable losses when evidence is weak", () => {
    const snap = makeSnapshot("ENTER", "buy", { change7dPct: -15, change24hPct: -5, sparkline7d: [60_000, 55_000, 50_000] }, 0.3, 0.3);
    const out = makeOutcome({ exitPrice: 57_000, realizedReturnPct: -5, maePct: -8 });
    const reward = computeReward(snap, out);
    assert.equal(reward.avoidableLoss, "AVOIDABLE");
  });

  it("does not mark a positive trade as avoidable loss", () => {
    const snap = makeSnapshot();
    const out = makeOutcome();
    const reward = computeReward(snap, out);
    assert.equal(reward.avoidableLoss, null);
  });

  it("classifies bad decision / good outcome", () => {
    const snap = makeSnapshot("ENTER", "buy", {}, 0.3, 0.3);
    const out = makeOutcome();
    const reward = computeReward(snap, out);
    assert.equal(reward.decisionOutcomeClass, "BAD_GOOD");
  });

  it("penalizes excessive slippage and fees", () => {
    const snap = makeSnapshot();
    const out = makeOutcome({ slippageBps: 250, feesUsd: 500, realizedPnlUsd: 200 });
    const reward = computeReward(snap, out);
    assert.ok(reward.components.slippagePenalty < 0);
    assert.ok(reward.components.feePenalty < 0);
  });

  it("penalizes contradiction with bearish HTF trend", () => {
    const snap = makeSnapshot("ENTER", "buy", { change7dPct: -20, sparkline7d: [60_000, 55_000, 50_000] });
    const out = makeOutcome();
    const reward = computeReward(snap, out);
    assert.ok(reward.components.contradictionPenalty < 0);
  });

  it("is deterministic for identical inputs", () => {
    const snap = makeSnapshot();
    const out = makeOutcome();
    const a = computeReward(snap, out);
    const b = computeReward(snap, out);
    assert.equal(a.totalReward, b.totalReward);
    assert.deepEqual(a.components, b.components);
  });
});
