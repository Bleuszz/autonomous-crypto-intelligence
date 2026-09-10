import { clamp, num0 } from "../math.ts";
import { rid } from "./snapshots.ts";
import type { DecisionOutcomeClass, DecisionSnapshot, RewardComponents, TradeOutcome, TradeReward, AvoidableLoss } from "./types.ts";

export const REWARD_VERSION = "1.0.0";

function signedReturnPct(outcome: TradeOutcome): number {
  return outcome.realizedReturnPct;
}

function rMultiple(outcome: TradeOutcome): number {
  if (outcome.realizedRMultiple != null) return outcome.realizedRMultiple;
  const stopDistance = 0.05;
  if (stopDistance <= 0 || !Number.isFinite(outcome.realizedReturnPct)) return 0;
  return outcome.realizedReturnPct / 100 / stopDistance;
}

function directionalCorrectness(snapshot: DecisionSnapshot, outcome: TradeOutcome): number {
  const side = snapshot.side;
  if (!side) return 0;
  const ret = signedReturnPct(outcome);
  if (side === "buy") return ret > 0 ? 1 : ret < 0 ? -1 : 0;
  return ret < 0 ? 1 : ret > 0 ? -1 : 0;
}

function entryTimingScore(outcome: TradeOutcome): number {
  // Favour trades where MFE is large relative to MAE.
  const mfe = num0(outcome.mfePct);
  const mae = Math.abs(num0(outcome.maePct));
  if (mae <= 0 && mfe > 0) return 0.25;
  if (mae <= 0) return 0;
  const ratio = mfe / mae;
  if (ratio > 2.5) return 0.2;
  if (ratio > 1.2) return 0.08;
  if (ratio < 0.5) return -0.15;
  return 0;
}

function executionQuality(outcome: TradeOutcome, snapshot: DecisionSnapshot): number {
  let q = 0;
  // Penalize excessive slippage vs assumption.
  const assumedSlippage = snapshot.executionAssumptions?.baseSlippageBps ?? 8;
  const actualSlippage = outcome.slippageBps;
  if (actualSlippage > assumedSlippage * 3) q -= 0.12;
  else if (actualSlippage > assumedSlippage * 1.5) q -= 0.05;
  else q += 0.04;

  // Penalize high fee/gas drag relative to gross P&L.
  const costRatio = Math.abs(outcome.feesUsd + outcome.gasUsd) / Math.max(1, Math.abs(outcome.realizedPnlUsd));
  if (costRatio > 0.5 && outcome.realizedPnlUsd > 0) q -= 0.08;
  else if (costRatio > 1 && outcome.realizedPnlUsd <= 0) q -= 0.05;

  // Latency penalty if holding time is tiny and costs dominate.
  if (outcome.holdingSeconds < 60 && (outcome.feesUsd + outcome.gasUsd) > Math.abs(outcome.realizedPnlUsd) * 0.25) {
    q -= 0.05;
  }
  return clamp(q, -0.25, 0.15);
}

function decisionQuality(snapshot: DecisionSnapshot, outcome: TradeOutcome): number {
  let q = 0;
  const f = snapshot.features;

  // Strong confirmation features present at entry should be rewarded when thesis works.
  if (f.momentum > 0.6 && f.volumeAnomaly > 0.35 && f.liquidity > 0.45) q += 0.1;
  if (f.marketQuality > 0.55 && f.rugRisk < 0.35) q += 0.08;

  // Entering against bearish higher-timeframe structure is suspect.
  if (snapshot.marketStructure.htfTrend === "bearish" && snapshot.decision === "ENTER") q -= 0.12;

  // Price near 7d highs reduces reward for chasing.
  if (snapshot.marketStructure.priceVs7dHigh === "near_high" && f.momentum > 0.65) q -= 0.08;

  // Evidence agreement: high confidence with supporting social/news.
  if (snapshot.evidence.signalAgreement > 0.6 && (snapshot.evidence.newsBoost > 0.3 || snapshot.evidence.socialBoost > 0.3)) {
    q += 0.05;
  }
  if (snapshot.evidence.contradictorySignals > 1) q -= 0.1;

  // Directional correctness of thesis.
  q += 0.12 * directionalCorrectness(snapshot, outcome);

  // Good entry timing.
  q += entryTimingScore(outcome);

  return clamp(q, -0.35, 0.35);
}

function outcomeQuality(outcome: TradeOutcome): number {
  const r = rMultiple(outcome);
  // R-multiple scaled reward.
  const rScore = Math.tanh(r * 0.4);

  // Favour favourable excursion and penalize deep adverse excursion.
  const mfe = num0(outcome.mfePct);
  const mae = Math.abs(num0(outcome.maePct));
  const excursionScore = Math.tanh(mfe / 8) - Math.tanh(mae / 6);

  // Holding time efficiency: positive outcomes should not require excessive time.
  const hours = outcome.holdingSeconds / 3600;
  const timeEfficiency = outcome.realizedReturnPct > 0 ? Math.tanh(24 / Math.max(1, hours)) * 0.08 : 0;

  // Post-exit continuation penalty / reward.
  const postExit = num0(outcome.postExitReturnPct);
  const postExitScore = outcome.realizedReturnPct > 0 && postExit > 0 ? 0.04 : outcome.realizedReturnPct > 0 && postExit < 0 ? -0.05 : 0;

  return clamp(rScore + excursionScore * 0.15 + timeEfficiency + postExitScore, -1, 1);
}

function riskDiscipline(snapshot: DecisionSnapshot, outcome: TradeOutcome): number {
  let q = 0;
  const r = snapshot.riskState;

  // Position size within limits.
  if (r.positionPctOfEquity > 0.12) q -= 0.1;
  else if (r.positionPctOfEquity <= 0.08 && snapshot.decision === "ENTER") q += 0.05;

  // Liquidity take within bounds.
  if (r.liquidityTakePct > 0.02) q -= 0.12;
  else if (snapshot.decision === "ENTER" && r.liquidityTakePct <= 0.01) q += 0.04;

  // Stop discipline: if stop was hit, small penalty unless it was a normal exit.
  if (outcome.stopHit && outcome.realizedReturnPct < -0.03) q -= 0.06;

  // Daily loss circuit respected.
  if (r.dailyLossUsedPct > 0.07) q -= 0.08;

  // Drawdown impact on portfolio.
  const dd = num0(outcome.drawdownImpactPct);
  if (dd > 0.05) q -= 0.1;

  return clamp(q, -0.3, 0.2);
}

function avoidableLoss(snapshot: DecisionSnapshot, outcome: TradeOutcome): AvoidableLoss {
  // A loss is avoidable when the evidence at entry was weak or contradictory.
  if (outcome.realizedReturnPct >= 0) return null;

  const f = snapshot.features;
  const contradictions =
    (snapshot.marketStructure.htfTrend === "bearish" && snapshot.decision === "ENTER" ? 1 : 0) +
    (snapshot.evidence.contradictorySignals > 0 ? 1 : 0) +
    (f.rugRisk > 0.45 ? 1 : 0) +
    (f.executionPenalty > 0.25 ? 1 : 0) +
    (snapshot.dataQuality.priceFresh === false ? 1 : 0);

  const weakEvidence = f.score < 0.45 || f.confidence < 0.45 || f.liquidity < 0.35;

  if (contradictions >= 2 && weakEvidence) return "AVOIDABLE";
  if (contradictions >= 1 && outcome.maePct != null && outcome.maePct < -0.06) return "AVOIDABLE";
  if (contradictions >= 1) return "PROBABLY_UNAVOIDABLE";
  return "INSUFFICIENT_EVIDENCE";
}

function decisionOutcomeClass(snapshot: DecisionSnapshot, outcome: TradeOutcome): DecisionOutcomeClass {
  const goodDecision = snapshot.features.score >= 0.45 && snapshot.features.confidence >= 0.4 && snapshot.riskState.hardLimitsHit.length === 0;
  const goodOutcome = outcome.realizedReturnPct > 0;
  if (goodDecision && goodOutcome) return "GOOD_GOOD";
  if (goodDecision && !goodOutcome) return "GOOD_BAD";
  if (!goodDecision && goodOutcome) return "BAD_GOOD";
  return "BAD_BAD";
}

export function computeReward(snapshot: DecisionSnapshot, outcome: TradeOutcome): TradeReward {
  const oc = outcomeQuality(outcome);
  const dc = decisionQuality(snapshot, outcome);
  const ex = executionQuality(outcome, snapshot);
  const rd = riskDiscipline(snapshot, outcome);

  const drawdownPenalty = -Math.tanh(num0(outcome.drawdownImpactPct) / 0.05) * 0.1;
  const slippagePenalty = -Math.tanh(Math.max(0, outcome.slippageBps - 20) / 40) * 0.08;
  const feePenalty = -Math.tanh((outcome.feesUsd + outcome.gasUsd) / Math.max(1, Math.abs(outcome.realizedPnlUsd))) * 0.06;

  // Contradiction penalty when the decision ignored bearish structure or contradictory signals.
  let contradictionPenalty = 0;
  if (snapshot.marketStructure.htfTrend === "bearish" && snapshot.decision === "ENTER") contradictionPenalty -= 0.08;
  if (snapshot.evidence.contradictorySignals > 0) contradictionPenalty -= 0.04 * snapshot.evidence.contradictorySignals;
  contradictionPenalty = clamp(contradictionPenalty, -0.2, 0);

  const components: RewardComponents = {
    outcomeQuality: clamp(oc, -1, 1),
    decisionQuality: clamp(dc, -0.35, 0.35),
    executionQuality: clamp(ex, -0.25, 0.15),
    riskDiscipline: clamp(rd, -0.3, 0.2),
    drawdownPenalty: clamp(drawdownPenalty, -0.15, 0),
    slippagePenalty: clamp(slippagePenalty, -0.1, 0),
    feePenalty: clamp(feePenalty, -0.1, 0),
    contradictionPenalty: clamp(contradictionPenalty, -0.2, 0),
  };

  const total =
    components.outcomeQuality * 0.35 +
    components.decisionQuality * 0.25 +
    components.executionQuality * 0.15 +
    components.riskDiscipline * 0.15 +
    components.drawdownPenalty +
    components.slippagePenalty +
    components.feePenalty +
    components.contradictionPenalty;

  return {
    id: rid(),
    outcomeId: outcome.id,
    decisionSnapshotId: snapshot.id,
    totalReward: clamp(total, -1, 1),
    components,
    avoidableLoss: avoidableLoss(snapshot, outcome),
    decisionOutcomeClass: decisionOutcomeClass(snapshot, outcome),
    version: REWARD_VERSION,
    createdAt: new Date().toISOString(),
  };
}

export function rewardBreakdown(reward: TradeReward): string {
  const c = reward.components;
  return [
    `TOTAL REWARD: ${reward.totalReward >= 0 ? "+" : ""}${reward.totalReward.toFixed(2)}`,
    `Outcome:              ${c.outcomeQuality >= 0 ? "+" : ""}${c.outcomeQuality.toFixed(2)}`,
    `Decision quality:     ${c.decisionQuality >= 0 ? "+" : ""}${c.decisionQuality.toFixed(2)}`,
    `Execution:            ${c.executionQuality >= 0 ? "+" : ""}${c.executionQuality.toFixed(2)}`,
    `Risk discipline:      ${c.riskDiscipline >= 0 ? "+" : ""}${c.riskDiscipline.toFixed(2)}`,
    `Drawdown penalty:     ${c.drawdownPenalty.toFixed(2)}`,
    `Slippage penalty:     ${c.slippagePenalty.toFixed(2)}`,
    `Fee penalty:          ${c.feePenalty.toFixed(2)}`,
    `Contradiction penalty:${c.contradictionPenalty.toFixed(2)}`,
  ].join("\n");
}
