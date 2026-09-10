import { clamp } from "../math.ts";
import { buildPatternConditions, type PatternConditions } from "./patterns.ts";
import { rid } from "./snapshots.ts";
import type { DecisionAction, DecisionSnapshot, DiscoveredPattern, LearnerRecommendation, LearnerVersion, SerializableRecord, TradeReward } from "./types.ts";

export const DEFAULT_LEARNER_VERSION = "0.1.0-shadow";
export const DEFAULT_STRATEGY_ID = "ensemble";
export const DEFAULT_STRATEGY_VERSION = "1.0.0";

const FEATURE_WEIGHTS: Record<string, number> = {
  momentumBand: 0.18,
  liquidityBand: 0.14,
  volumeBand: 0.12,
  htfTrend: 0.16,
  priceVsHigh: 0.12,
  volatility: 0.08,
  isMajor: 0.08,
  isDex: 0.06,
  regime: 0.18,
  assetScope: 0.1,
};

function conditionsSimilarity(a: PatternConditions, b: PatternConditions): number {
  let score = 0;
  let weight = 0;
  for (const [key, w] of Object.entries(FEATURE_WEIGHTS)) {
    const av = a[key as keyof PatternConditions];
    const bv = b[key as keyof PatternConditions];
    if (av === undefined || bv === undefined) continue;
    weight += w;
    score += (av === bv ? 1 : 0) * w;
  }
  return weight > 0 ? score / weight : 0;
}

export function estimateExpectedReward(opts: {
  snapshot: DecisionSnapshot;
  action: DecisionAction;
  patterns: DiscoveredPattern[];
  minSimilarity?: number;
  recencyDecayDays?: number;
}): { expectedReward: number; confidence: number; matchedPatterns: DiscoveredPattern[]; reasons: string[] } {
  const target = buildPatternConditions(opts.snapshot);
  const targetAction = opts.action;
  const minSim = opts.minSimilarity ?? 0.55;
  const decayDays = opts.recencyDecayDays ?? 30;
  const actionAt = Date.parse(opts.snapshot.actionAt);
  const timeFrontier = Number.isFinite(actionAt) ? actionAt : Date.now();

  const matched = opts.patterns
    .filter((p) => p.action === targetAction)
    .map((p) => {
      const lastSeen = Date.parse(p.lastSeenAt);
      // A historical recommendation cannot consult a pattern observed later.
      if (!Number.isFinite(lastSeen) || lastSeen > timeFrontier) return null;
      const daysAgo = Math.max(0, (timeFrontier - lastSeen) / (24 * 3600 * 1000));
      const recency = Math.exp(-daysAgo / Math.max(decayDays, 0.001));
      const sim = conditionsSimilarity(target, p.conditions as PatternConditions);
      const sampleWeight = Math.min(1, Math.sqrt(Math.max(0, p.sampleCount)) / Math.sqrt(30));
      return { p, sim, recency, sampleWeight, weight: sim * recency * sampleWeight };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .filter(({ sim }) => sim >= minSim)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 12);

  if (!matched.length) {
    return {
      expectedReward: 0,
      confidence: 0,
      matchedPatterns: [],
      reasons: ["No historically similar patterns for this action."],
    };
  }

  let num = 0;
  let den = 0;
  const patternReasons: string[] = [];
  for (const { p, sim, recency, weight: w } of matched) {
    const expectancy = p.oosExpectancy ?? p.expectancy ?? 0;
    num += w * expectancy;
    den += w;
    patternReasons.push(
      `${p.description} (sim ${sim.toFixed(2)}, recency ${recency.toFixed(2)}, n=${p.sampleCount}, exp ${expectancy.toFixed(3)})`,
    );
  }

  // Shrink sparse or stale evidence toward a neutral prior. Recency would
  // otherwise cancel out when only one matching pattern exists.
  const neutralPriorWeight = 0.5;
  const expectedReward = den > 0 ? num / (den + neutralPriorWeight) : 0;
  const confidence = clamp(Math.min(1, den / 3) * matched[0]!.sim, 0, 1);

  return {
    expectedReward: clamp(expectedReward, -1, 1),
    confidence,
    matchedPatterns: matched.map((m) => m.p),
    reasons: [
      `Weighted estimate from ${matched.length} matching ${targetAction} patterns`,
      ...patternReasons.slice(0, 4),
    ],
  };
}

export function recommendAction(opts: {
  snapshot: DecisionSnapshot;
  patterns: DiscoveredPattern[];
  baseThreshold?: number;
}): LearnerRecommendation {
  const actions: DecisionAction[] = ["ENTER", "WAIT", "REJECT"];
  const estimates = actions.map((action) => estimateExpectedReward({ snapshot: opts.snapshot, action, patterns: opts.patterns }));

  let bestIdx = 0;
  let bestVal = -Infinity;
  for (let i = 0; i < estimates.length; i++) {
    if (estimates[i]!.expectedReward > bestVal) {
      bestVal = estimates[i]!.expectedReward;
      bestIdx = i;
    }
  }
  const best = estimates[bestIdx]!;
  const action = actions[bestIdx]!;

  const reasons = [
    `ENTER expected reward: ${estimates[0]!.expectedReward >= 0 ? "+" : ""}${estimates[0]!.expectedReward.toFixed(2)}`,
    `WAIT expected reward:  ${estimates[1]!.expectedReward >= 0 ? "+" : ""}${estimates[1]!.expectedReward.toFixed(2)}`,
    `REJECT expected reward: ${estimates[2]!.expectedReward >= 0 ? "+" : ""}${estimates[2]!.expectedReward.toFixed(2)}`,
    ...best.reasons,
  ];

  return {
    action,
    expectedReward: best.expectedReward,
    confidence: best.confidence,
    reasons,
  };
}

export function createLearnerVersion(opts: {
  version: string;
  strategyId: string;
  strategyVersion: string;
  status?: LearnerVersion["status"];
  featuresUsed?: string[];
  hyperparameters?: SerializableRecord;
  trainingExperienceCount?: number;
  trainingPeriodStart?: string;
  trainingPeriodEnd?: string;
}): LearnerVersion {
  return {
    learnerId: rid(),
    learnerVersion: opts.version,
    status: opts.status ?? "SHADOW",
    strategyId: opts.strategyId,
    strategyVersion: opts.strategyVersion,
    trainingPeriodStart: opts.trainingPeriodStart ?? null,
    trainingPeriodEnd: opts.trainingPeriodEnd ?? null,
    trainingExperienceCount: opts.trainingExperienceCount ?? 0,
    featuresUsed: opts.featuresUsed ?? Object.keys(FEATURE_WEIGHTS),
    hyperparameters: opts.hyperparameters ?? { minSimilarity: 0.55, recencyDecayDays: 30, sampleSizeGate: 8 },
    validationMetrics: {},
    oosMetrics: {},
    walkForwardMetrics: {},
    ablationResults: {},
    sensitivityResults: {},
    championVersion: null,
    createdAt: new Date().toISOString(),
    approvedAt: null,
    rejectedAt: null,
    rolledBackAt: null,
    rollbackReason: null,
  };
}

export function evaluateLearner(opts: {
  predictions: Array<{ predicted: DecisionAction; actual: TradeReward }>;
}): { accuracy: number; calibration: number; avgPredictedReward: number; avgActualReward: number } {
  const n = opts.predictions.length;
  if (!n) return { accuracy: 0, calibration: 0, avgPredictedReward: 0, avgActualReward: 0 };

  let correct = 0;
  let predSum = 0;
  let actualSum = 0;
  for (const { predicted, actual } of opts.predictions) {
    // Treat prediction as correct if predicted action matches the sign of actual reward.
    const predictedPositive = predicted === "ENTER" || predicted === "WAIT";
    if ((predictedPositive && actual.totalReward > 0) || (predicted === "REJECT" && actual.totalReward < 0)) {
      correct++;
    }
    predSum += actual.totalReward; // we do not store predicted numeric in this simple API
    actualSum += actual.totalReward;
  }
  const accuracy = correct / n;
  const avgPredictedReward = predSum / n;
  const avgActualReward = actualSum / n;
  const calibration = 1 - Math.min(1, Math.abs(avgPredictedReward - avgActualReward));
  return { accuracy, calibration, avgPredictedReward, avgActualReward };
}
