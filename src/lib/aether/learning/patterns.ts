import { rid } from "./snapshots.ts";
import type { DecisionAction, DecisionSnapshot, DiscoveredPattern, TradeReward } from "./types.ts";

export const MIN_PATTERN_SAMPLES = 8;
export const MIN_PATTERN_POSITIVE = 3;
export const CONFIDENCE_Z = 1.645; // 90% normal CI

export type PatternConditions = {
  momentumBand?: "high" | "medium" | "low";
  liquidityBand?: "high" | "medium" | "low";
  volumeBand?: "high" | "medium" | "low";
  htfTrend?: "bullish" | "bearish" | "neutral";
  priceVsHigh?: "near_high" | "mid" | "near_low";
  volatility?: "low" | "medium" | "high";
  isMajor?: boolean;
  isDex?: boolean;
  regime?: string;
  assetScope?: string;
};

function band(value: number, low: number, high: number): "low" | "medium" | "high" {
  if (value < low) return "low";
  if (value > high) return "high";
  return "medium";
}

export function buildPatternConditions(snapshot: DecisionSnapshot): PatternConditions {
  const f = snapshot.features;
  const regime = (snapshot.regime.label as string | undefined) ?? "mixed";
  return {
    momentumBand: band(f.momentum, 0.4, 0.65),
    liquidityBand: band(f.liquidity, 0.35, 0.65),
    volumeBand: band(f.volumeAnomaly, 0.3, 0.6),
    htfTrend: snapshot.marketStructure.htfTrend,
    priceVsHigh: snapshot.marketStructure.priceVs7dHigh,
    volatility: snapshot.marketStructure.volatilityRegime,
    isMajor: f.isMajor,
    isDex: f.isDex,
    regime,
  };
}

export function hashConditions(conditions: PatternConditions): string {
  const parts = [
    `m:${conditions.momentumBand ?? "any"}`,
    `l:${conditions.liquidityBand ?? "any"}`,
    `v:${conditions.volumeBand ?? "any"}`,
    `t:${conditions.htfTrend ?? "any"}`,
    `p:${conditions.priceVsHigh ?? "any"}`,
    `vol:${conditions.volatility ?? "any"}`,
    `maj:${conditions.isMajor ?? "any"}`,
    `dex:${conditions.isDex ?? "any"}`,
    `r:${conditions.regime ?? "any"}`,
  ];
  return parts.join("|");
}

export function describePattern(conditions: PatternConditions): string {
  const parts: string[] = [];
  if (conditions.momentumBand) parts.push(`${conditions.momentumBand} momentum`);
  if (conditions.liquidityBand) parts.push(`${conditions.liquidityBand} liquidity`);
  if (conditions.volumeBand) parts.push(`${conditions.volumeBand} volume`);
  if (conditions.htfTrend) parts.push(`${conditions.htfTrend} HTF trend`);
  if (conditions.priceVsHigh) parts.push(`${conditions.priceVsHigh} vs 7d high`);
  if (conditions.volatility) parts.push(`${conditions.volatility} volatility`);
  if (conditions.isMajor != null) parts.push(conditions.isMajor ? "major asset" : "non-major asset");
  if (conditions.isDex != null) parts.push(conditions.isDex ? "DEX asset" : "non-DEX asset");
  if (conditions.regime) parts.push(`regime: ${conditions.regime}`);
  return parts.join(" + ") || "unconditional";
}

export function winsonMeanAndCI(rewards: number[]): { mean: number; lower: number; upper: number; variance: number } {
  const n = rewards.length;
  if (n === 0) return { mean: 0, lower: 0, upper: 0, variance: 0 };
  const mean = rewards.reduce((a, b) => a + b, 0) / n;
  const variance = rewards.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n);
  const stderr = Math.sqrt(variance / Math.max(1, n));
  const half = CONFIDENCE_Z * stderr;
  return { mean, lower: mean - half, upper: mean + half, variance };
}

export function sampleSizeStatus(count: number): "INSUFFICIENT" | "WEAK" | "ADEQUATE" | "STRONG" {
  if (count < MIN_PATTERN_SAMPLES) return "INSUFFICIENT";
  if (count < 15) return "WEAK";
  if (count < 30) return "ADEQUATE";
  return "STRONG";
}

export function discoverPatterns(opts: {
  snapshots: DecisionSnapshot[];
  rewards: TradeReward[];
  action: DecisionAction;
  groupByRegime?: boolean;
  groupByAssetScope?: boolean;
  nowMs?: number;
  learnerVersion?: string;
}): DiscoveredPattern[] {
  const rewardBySnapshot = new Map<string, TradeReward>();
  for (const r of opts.rewards) rewardBySnapshot.set(r.decisionSnapshotId, r);

  const groups = new Map<string, { conditions: PatternConditions; rewards: number[]; positives: number; negatives: number; times: number[] }>();

  for (const snapshot of opts.snapshots) {
    if (snapshot.decision !== opts.action) continue;
    const reward = rewardBySnapshot.get(snapshot.id);
    if (!reward) continue;

    const base = buildPatternConditions(snapshot);
    const conditions: PatternConditions = {
      ...base,
      regime: opts.groupByRegime ? base.regime : undefined,
      assetScope: opts.groupByAssetScope ? (base.isMajor ? "major" : base.isDex ? "dex" : "other") : undefined,
    };
    // Regime/assetScope are not in PatternConditions type for assetScope, so add as string.
    const hash = hashConditions(conditions) + `|scope:${conditions.assetScope ?? "any"}`;

    const g = groups.get(hash) ?? { conditions, rewards: [], positives: 0, negatives: 0, times: [] };
    g.rewards.push(reward.totalReward);
    if (reward.totalReward > 0) g.positives++;
    else g.negatives++;
    g.times.push(new Date(snapshot.actionAt).getTime());
    groups.set(hash, g);
  }

  const out: DiscoveredPattern[] = [];
  const now = opts.nowMs ?? Date.now();
  for (const g of groups.values()) {
    const n = g.rewards.length;
    if (n < 5) continue; // too small to even consider
    const stats = winsonMeanAndCI(g.rewards);
    const positiveRate = g.positives / n;
    const recency = g.times.length ? Math.exp(-(now - Math.max(...g.times)) / (7 * 24 * 3600 * 1000)) : 1;

    out.push({
      id: rid(),
      patternHash: hashConditions(g.conditions),
      status: n >= MIN_PATTERN_SAMPLES && g.positives >= MIN_PATTERN_POSITIVE ? "DISCOVERED" : "SHADOW",
      description: describePattern(g.conditions),
      conditions: g.conditions as Record<string, string | number | boolean>,
      action: opts.action,
      regime: g.conditions.regime ?? null,
      assetScope: (g.conditions.assetScope as string | undefined) ?? null,
      sampleCount: n,
      positiveCount: g.positives,
      negativeCount: g.negatives,
      winRate: positiveRate,
      expectancy: stats.mean,
      avgReward: stats.mean,
      rewardVariance: stats.variance,
      confidenceLower: stats.lower,
      confidenceUpper: stats.upper,
      oosExpectancy: null,
      walkForwardStability: null,
      recencyWeight: recency,
      firstSeenAt: new Date(Math.min(...g.times)).toISOString(),
      lastSeenAt: new Date(Math.max(...g.times)).toISOString(),
      promotedAt: null,
      rolledBackAt: null,
      championVersion: null,
      learnerVersion: opts.learnerVersion ?? "none",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  return out.sort((a, b) => (b.expectancy ?? -Infinity) - (a.expectancy ?? -Infinity));
}

export function updatePatternOOS(pattern: DiscoveredPattern, oosRewards: number[]): DiscoveredPattern {
  if (!oosRewards.length) return pattern;
  const stats = winsonMeanAndCI(oosRewards);
  return {
    ...pattern,
    oosExpectancy: stats.mean,
    confidenceLower: stats.lower,
    confidenceUpper: stats.upper,
    rewardVariance: stats.variance,
    updatedAt: new Date().toISOString(),
  };
}

export function canPromote(pattern: DiscoveredPattern): { ok: boolean; reason: string } {
  if (pattern.status === "APPROVED") return { ok: false, reason: "Already approved" };
  if (pattern.sampleCount < MIN_PATTERN_SAMPLES) return { ok: false, reason: `Insufficient samples (${pattern.sampleCount} < ${MIN_PATTERN_SAMPLES})` };
  if (pattern.positiveCount < MIN_PATTERN_POSITIVE) return { ok: false, reason: `Insufficient positive samples (${pattern.positiveCount})` };
  if ((pattern.expectancy ?? 0) <= 0) return { ok: false, reason: "Expectancy is not positive" };
  if ((pattern.confidenceLower ?? 0) <= 0) return { ok: false, reason: "Lower confidence bound is not positive" };
  if (pattern.oosExpectancy != null && pattern.oosExpectancy <= 0) return { ok: false, reason: "OOS expectancy is not positive" };
  return { ok: true, reason: "" };
}

export function promotePattern(pattern: DiscoveredPattern, championVersion: string): DiscoveredPattern {
  const check = canPromote(pattern);
  if (!check.ok) return pattern;
  return { ...pattern, status: "APPROVED", promotedAt: new Date().toISOString(), championVersion, updatedAt: new Date().toISOString() };
}

export function rejectPattern(pattern: DiscoveredPattern, _reason?: string): DiscoveredPattern {
  return { ...pattern, status: "REJECTED", updatedAt: new Date().toISOString() };
}

export function rollBackPattern(pattern: DiscoveredPattern): DiscoveredPattern {
  return { ...pattern, status: "REJECTED", rolledBackAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}
