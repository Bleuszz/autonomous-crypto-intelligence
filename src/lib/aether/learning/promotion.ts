import { rid } from "./snapshots.ts";
import type { ChampionChallengerMetrics, DecisionSnapshot, DiscoveredPattern, LearnerVersion, PromotionStage, StrategyCandidate, TradeReward } from "./types.ts";

export type PromotionResult = {
  ok: boolean;
  reason: string;
  nextStage: PromotionStage;
};

export function createStrategyCandidate(opts: {
  strategyId: string;
  strategyVersion: string;
  learnerVersion: string;
  championVersion?: string | null;
}): StrategyCandidate {
  return {
    id: rid(),
    strategyId: opts.strategyId,
    strategyVersion: opts.strategyVersion,
    learnerVersion: opts.learnerVersion,
    championVersion: opts.championVersion ?? null,
    status: "CANDIDATE",
    promotionPipeline: { current: "DISCOVERED", history: ["DISCOVERED"] },
    validationResults: {},
    createdAt: new Date().toISOString(),
    approvedAt: null,
    rolledBackAt: null,
    rollbackReason: null,
  };
}

export function stageOrder(stage: PromotionStage): number {
  const map: Record<PromotionStage, number> = {
    DISCOVERED: 0,
    SHADOW: 1,
    TRAINED: 2,
    VALIDATED: 3,
    "OUT-OF-SAMPLE": 4,
    "WALK-FORWARD": 5,
    "STABILITY-CHECK": 6,
    "PAPER-CANARY": 7,
    APPROVED: 8,
    REJECTED: -1,
  };
  return map[stage];
}

export function compareChallengerToChampion(
  challenger: ChampionChallengerMetrics,
  champion: ChampionChallengerMetrics,
): {
  wins: number;
  total: number;
  primaryWins: number;
  primaryTotal: number;
  details: Record<string, { winner: "challenger" | "champion" | "tie"; delta: number }>;
} {
  // Primary: risk-adjusted, expectancy, drawdown, payoff, OOS. NOT profit or win rate alone.
  const metrics: Array<{ key: string; higherIsBetter: boolean; primary: boolean }> = [
    { key: "sharpe", higherIsBetter: true, primary: true },
    { key: "expectancy", higherIsBetter: true, primary: true },
    { key: "payoffRatio", higherIsBetter: true, primary: true },
    { key: "calmar", higherIsBetter: true, primary: true },
    { key: "maxDrawdownPct", higherIsBetter: false, primary: true },
    { key: "oosExpectancy", higherIsBetter: true, primary: true },
    { key: "oosSharpe", higherIsBetter: true, primary: true },
    { key: "calibrationError", higherIsBetter: false, primary: true },
    { key: "totalReturnPct", higherIsBetter: true, primary: false },
    { key: "winRate", higherIsBetter: true, primary: false },
  ];

  const details: Record<string, { winner: "challenger" | "champion" | "tie"; delta: number }> = {};
  let wins = 0;
  let primaryWins = 0;
  let primaryTotal = 0;
  for (const m of metrics) {
    const cVal = challenger[m.key as keyof ChampionChallengerMetrics] as number | null | undefined;
    const chVal = champion[m.key as keyof ChampionChallengerMetrics] as number | null | undefined;
    if (cVal == null || chVal == null || !Number.isFinite(cVal) || !Number.isFinite(chVal)) continue;
    const delta = m.higherIsBetter ? cVal - chVal : chVal - cVal;
    const winner = Math.abs(delta) < 0.001 ? "tie" : delta > 0 ? "challenger" : "champion";
    if (winner === "challenger") wins++;
    if (m.primary) {
      primaryTotal++;
      if (winner === "challenger") primaryWins++;
    }
    details[m.key] = { winner, delta };
  }

  // Check parameter sensitivity: if any cost variant destroys challenger, count as champion win.
  const costKeys = Object.keys(challenger.costSensitivity);
  if (costKeys.length) {
    let fragile = 0;
    for (const k of costKeys) {
      if ((challenger.costSensitivity[k] ?? 0) < 0 && (champion.costSensitivity[k] ?? 0) >= 0) fragile++;
    }
    if (fragile >= 2) {
      details["costSensitivity"] = { winner: "champion", delta: fragile };
    } else {
      details["costSensitivity"] = { winner: "tie", delta: 0 };
    }
  }

  return { wins, total: Object.keys(details).length, details, primaryWins, primaryTotal };
}

export function canAdvanceStage(opts: {
  candidate: StrategyCandidate;
  learner: LearnerVersion;
  patterns: DiscoveredPattern[];
  experiences: Array<{ snapshot: DecisionSnapshot; reward: TradeReward; validationStatus: string }>;
}): PromotionResult {
  const history = opts.candidate.promotionPipeline.history;
  const current = history[history.length - 1] ?? "DISCOVERED";

  switch (current) {
    case "DISCOVERED":
      return { ok: true, reason: "Pattern discovered; move to shadow observation.", nextStage: "SHADOW" };
    case "SHADOW": {
      const shadowExperiences = opts.experiences.filter((e) => e.validationStatus === "IN_SAMPLE").length;
      if (shadowExperiences < 10) return { ok: false, reason: "Need at least 10 shadow experiences.", nextStage: current };
      return { ok: true, reason: "Shadow observation complete.", nextStage: "TRAINED" };
    }
    case "TRAINED": {
      if (opts.learner.trainingExperienceCount < 20) return { ok: false, reason: "Learner needs >= 20 training experiences.", nextStage: current };
      return { ok: true, reason: "Training set sufficient.", nextStage: "VALIDATED" };
    }
    case "VALIDATED": {
      const oos = opts.experiences.filter((e) => e.validationStatus === "OOS").length;
      if (oos < 8) return { ok: false, reason: "Need >= 8 OOS experiences.", nextStage: current };
      return { ok: true, reason: "In-sample validation passed.", nextStage: "OUT-OF-SAMPLE" };
    }
    case "OUT-OF-SAMPLE": {
      const wf = opts.experiences.filter((e) => e.validationStatus === "WALK_FORWARD").length;
      if (wf < 5) return { ok: false, reason: "Need >= 5 walk-forward experiences.", nextStage: current };
      return { ok: true, reason: "OOS performance stable.", nextStage: "WALK-FORWARD" };
    }
    case "WALK-FORWARD": {
      const approvedPatterns = opts.patterns.filter((p) => p.status === "APPROVED").length;
      if (approvedPatterns < 2) return { ok: false, reason: "Need >= 2 promoted patterns.", nextStage: current };
      return { ok: true, reason: "Walk-forward stable; proceed to stability check.", nextStage: "STABILITY-CHECK" };
    }
    case "STABILITY-CHECK":
      return { ok: true, reason: "Stability checks passed; paper canary.", nextStage: "PAPER-CANARY" };
    case "PAPER-CANARY":
      return { ok: true, reason: "Paper canary healthy; candidate can be approved.", nextStage: "APPROVED" };
    case "APPROVED":
      return { ok: false, reason: "Already approved.", nextStage: current };
    case "REJECTED":
      return { ok: false, reason: "Candidate is rejected.", nextStage: current };
    default:
      return { ok: false, reason: "Unknown stage.", nextStage: current };
  }
}

export function advanceCandidate(candidate: StrategyCandidate, nextStage: PromotionStage): StrategyCandidate {
  if (nextStage === "REJECTED") {
    return { ...candidate, status: "REJECTED", promotionPipeline: { ...candidate.promotionPipeline, current: nextStage, history: [...candidate.promotionPipeline.history, nextStage] } };
  }
  const approvedAt = nextStage === "APPROVED" ? new Date().toISOString() : candidate.approvedAt;
  const status = nextStage === "APPROVED" ? "APPROVED" : (candidate.status as StrategyCandidate["status"]);
  return {
    ...candidate,
    status,
    approvedAt,
    promotionPipeline: { ...candidate.promotionPipeline, current: nextStage, history: [...candidate.promotionPipeline.history, nextStage] },
  };
}

export function rejectCandidate(candidate: StrategyCandidate, reason: string): StrategyCandidate {
  return {
    ...candidate,
    status: "REJECTED",
    promotionPipeline: { ...candidate.promotionPipeline, current: "REJECTED", history: [...candidate.promotionPipeline.history, "REJECTED"] },
    validationResults: { ...candidate.validationResults, rejectionReason: reason },
  };
}

export function rollBackCandidate(candidate: StrategyCandidate, reason: string): StrategyCandidate {
  return {
    ...candidate,
    status: "REJECTED",
    rolledBackAt: new Date().toISOString(),
    rollbackReason: reason,
    promotionPipeline: { ...candidate.promotionPipeline, current: "REJECTED", history: [...candidate.promotionPipeline.history, "REJECTED"] },
  };
}

export function championNeedsRollback(championMetrics: ChampionChallengerMetrics, sinceApprovedMs: number, minObservations = 5): { rollback: boolean; reason: string } {
  if (sinceApprovedMs < 3 * 24 * 3600 * 1000) return { rollback: false, reason: "Too early to evaluate post-approval performance." };
  if (championMetrics.nTrades < minObservations) return { rollback: false, reason: "Insufficient post-approval observations." };
  if (championMetrics.expectancy < -0.02) return { rollback: true, reason: `Post-approval expectancy ${championMetrics.expectancy.toFixed(3)} is negative.` };
  if (championMetrics.maxDrawdownPct > 15) return { rollback: true, reason: `Post-approval drawdown ${championMetrics.maxDrawdownPct.toFixed(1)}% exceeds 15%.` };
  return { rollback: false, reason: "Within post-approval tolerances." };
}

/**
 * In-sample luck is not a promotion. Challenger must beat champion on a majority
 * of primary (risk-adjusted / OOS / calibration) metrics. A higher backtest
 * return or win rate alone is not enough. Capital-dependent behaviour is refused.
 */
export function inSampleLuckGuard(opts: {
  inSampleExpectancy: number;
  oosExpectancy: number | null;
  inSampleSharpe: number;
  oosSharpe: number | null;
  uniqueDays: number;
}): { ok: boolean; reason: string } {
  if (opts.uniqueDays < 5) {
    return { ok: false, reason: "Do not promote from one lucky period. Need ≥ 5 distinct sessions." };
  }
  if (opts.oosExpectancy == null || opts.oosSharpe == null) {
    return { ok: false, reason: "INSUFFICIENT EVIDENCE: no out-of-sample metrics. In-sample return is not validation." };
  }
  if (opts.inSampleExpectancy > 0.5 && opts.oosExpectancy < opts.inSampleExpectancy * 0.3) {
    return { ok: false, reason: "In-sample expectancy collapsed out of sample — likely luck, not an edge." };
  }
  if (opts.inSampleSharpe > 1 && (opts.oosSharpe ?? 0) < 0.2) {
    return { ok: false, reason: "In-sample Sharpe did not survive walk-forward / OOS." };
  }
  if (opts.oosExpectancy < 0 && opts.inSampleExpectancy > 0) {
    return { ok: false, reason: "Positive in-sample expectancy with negative OOS — champion stands." };
  }
  return { ok: true, reason: "OOS metrics do not contradict in-sample." };
}

export function wouldReplaceChampion(opts: {
  challenger: ChampionChallengerMetrics;
  champion: ChampionChallengerMetrics;
  uniqueDays: number;
}): { replace: boolean; reason: string } {
  const luck = inSampleLuckGuard({
    inSampleExpectancy: opts.challenger.expectancy,
    oosExpectancy: opts.challenger.oosExpectancy ?? null,
    inSampleSharpe: opts.challenger.sharpe,
    oosSharpe: opts.challenger.oosSharpe ?? null,
    uniqueDays: opts.uniqueDays,
  });
  if (!luck.ok) return { replace: false, reason: luck.reason };
  if (opts.challenger.capitalClassification === "CAPITAL-DEPENDENT") {
    return { replace: false, reason: "CAPITAL-SCALE DEPENDENT — NOT DEPLOYMENT READY. Champion stands." };
  }
  const cmp = compareChallengerToChampion(opts.challenger, opts.champion);
  if (cmp.primaryTotal < 3) {
    return { replace: false, reason: "INSUFFICIENT EVIDENCE on primary risk-adjusted metrics." };
  }
  if (cmp.primaryWins <= cmp.primaryTotal / 2) {
    return { replace: false, reason: `Challenger wins ${cmp.primaryWins}/${cmp.primaryTotal} primary metrics. Profit/win-rate alone cannot replace the champion.` };
  }
  return { replace: true, reason: `Challenger wins ${cmp.primaryWins}/${cmp.primaryTotal} primary metrics and passes the luck / capital gates.` };
}

