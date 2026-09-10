import { nowIso } from "../time.ts";
import { clamp, num0 } from "../math.ts";
import type { DecisionAction, DecisionContext, DecisionEvidenceItem, DecisionFeatures, DecisionSnapshot, EvidenceState, ExecutionAssumptions, MarketStructure, SizingInfo, DataQuality } from "./types.ts";

export function rid(): string {
  return crypto.randomUUID();
}

export function sparkDistFromHigh(spark: number[] | null): number | null {
  if (!spark || spark.length < 2) return null;
  const xs = spark.filter((n) => Number.isFinite(n) && n > 0);
  if (!xs.length) return null;
  const last = xs[xs.length - 1]!;
  const hi = Math.max(...xs);
  if (!hi) return null;
  return ((hi - last) / hi) * 100;
}

export function htfTrend(spark: number[] | null, d7: number | null): MarketStructure["htfTrend"] {
  const dist = sparkDistFromHigh(spark);
  const week = num0(d7);
  if (week > 5 && (dist == null || dist < 5)) return "bullish";
  if (week < -8) return "bearish";
  return "neutral";
}

export function priceVsHigh(dist: number | null): MarketStructure["priceVs7dHigh"] {
  if (dist == null) return "mid";
  if (dist < 2.5) return "near_high";
  if (dist > 20) return "near_low";
  return "mid";
}

export function volatilityRegime(change24hPct: number | null): MarketStructure["volatilityRegime"] {
  const d24 = Math.abs(num0(change24hPct));
  if (d24 > 25) return "high";
  if (d24 > 8) return "medium";
  return "low";
}

export function buildMarketStructure(opts: {
  sparkline7d: number[] | null;
  change24hPct: number | null;
  change7dPct: number | null;
}): MarketStructure {
  const dist = sparkDistFromHigh(opts.sparkline7d);
  return {
    htfTrend: htfTrend(opts.sparkline7d, opts.change7dPct),
    priceVs7dHigh: priceVsHigh(dist),
    volatilityRegime: volatilityRegime(opts.change24hPct),
  };
}

export function buildFeatures(opts: {
  score: number;
  confidence: number;
  components: {
    marketQuality: number;
    liquidity: number;
    momentum: number;
    volumeAnomaly: number;
    smartMoney: number;
    social: number;
    news: number;
    riskPenalty: number;
    executionPenalty: number;
  };
  rugRisk: number;
  change1hPct: number | null;
  change24hPct: number | null;
  change7dPct: number | null;
  sparkline7d: number[] | null;
  isMajor: boolean;
  isDex: boolean;
}): DecisionFeatures {
  const dist = sparkDistFromHigh(opts.sparkline7d);
  return {
    momentum: clamp(num0(opts.components.momentum), 0, 1),
    liquidity: clamp(num0(opts.components.liquidity), 0, 1),
    volumeAnomaly: clamp(num0(opts.components.volumeAnomaly), 0, 1),
    marketQuality: clamp(num0(opts.components.marketQuality), 0, 1),
    smartMoney: clamp(num0(opts.components.smartMoney), 0, 1),
    social: clamp(num0(opts.components.social), 0, 1),
    news: clamp(num0(opts.components.news), 0, 1),
    riskPenalty: clamp(num0(opts.components.riskPenalty), 0, 1),
    executionPenalty: clamp(num0(opts.components.executionPenalty), 0, 1),
    score: clamp(num0(opts.score), 0, 1),
    confidence: clamp(num0(opts.confidence), 0, 1),
    rugRisk: clamp(num0(opts.rugRisk), 0, 1),
    change1hPct: opts.change1hPct,
    change24hPct: opts.change24hPct,
    change7dPct: opts.change7dPct,
    distFrom7dHighPct: dist,
    isMajor: opts.isMajor,
    isDex: opts.isDex,
  };
}

export function buildEvidence(opts: {
  newsBoost: number;
  socialBoost: number;
  walletHits: number;
  eventsNear: number;
  signalAgreement: number;
  contradictorySignals: number;
  items?: DecisionEvidenceItem[];
}): EvidenceState {
  return {
    version: "1.0",
    newsBoost: clamp(num0(opts.newsBoost), 0, 1),
    socialBoost: clamp(num0(opts.socialBoost), 0, 1),
    walletHits: Math.max(0, Math.round(opts.walletHits)),
    eventsNear: Math.max(0, Math.round(opts.eventsNear)),
    signalAgreement: clamp(num0(opts.signalAgreement), 0, 1),
    contradictorySignals: Math.max(0, Math.round(opts.contradictorySignals)),
    items: opts.items ?? [],
  };
}

function evidenceFromContext(ctx: DecisionContext, features: DecisionFeatures): EvidenceState {
  if (ctx.evidence) return buildEvidence(ctx.evidence);
  const observedAt = ctx.latestMarketDataTimestamp ?? ctx.ranked?.asset.observedAt ?? null;
  const reliability = clamp(num0(ctx.dataQuality?.sourceReliability ?? ctx.ranked?.asset.sourceReliability ?? 0), 0, 1);
  const stale = ctx.dataQuality?.priceFresh === false;
  const values: Array<[string, number, number]> = [
    ["market_quality", features.marketQuality, features.marketQuality - 0.5],
    ["liquidity", features.liquidity, features.liquidity - 0.5],
    ["momentum", features.momentum, features.momentum - 0.5],
    ["volume_anomaly", features.volumeAnomaly, features.volumeAnomaly - 0.5],
    ["smart_money", features.smartMoney, features.smartMoney - 0.5],
    ["news", features.news, features.news],
    ["social", features.social, features.social],
    ["risk_penalty", features.riskPenalty, -features.riskPenalty],
    ["execution_penalty", features.executionPenalty, -features.executionPenalty],
  ];
  const items: DecisionEvidenceItem[] = values.map(([feature, value, contribution]) => ({
    source: feature === "news" ? "news_fusion" : feature === "social" ? "social_fusion" : (ctx.dataQuality?.source ?? ctx.ranked?.asset.source ?? "derived"),
    feature,
    value,
    observedAt: feature === "news" ? (ctx.latestNewsTimestamp ?? observedAt) : feature === "social" ? (ctx.latestSocialTimestamp ?? observedAt) : observedAt,
    status: stale ? "stale" : "available",
    reliability,
    contribution,
    direction: contribution > 0.05 ? "positive" : contribution < -0.05 ? "negative" : "neutral",
    contradiction: contribution < -0.05,
    decisionImpact: contribution > 0.05 ? "supports entry" : contribution < -0.05 ? "opposes entry" : "neutral",
  }));
  const contradictions = items.filter((item) => item.contradiction).length + (ctx.dataQuality?.sourceConflict ? 1 : 0);
  const positive = items.filter((item) => item.direction === "positive").length;
  const directional = items.filter((item) => item.direction !== "neutral").length;
  return buildEvidence({
    newsBoost: features.news,
    socialBoost: features.social,
    walletHits: features.smartMoney > 0 ? Math.max(1, Math.round(features.smartMoney * 10)) : 0,
    eventsNear: ctx.latestEventTimestamp ? 1 : 0,
    signalAgreement: directional ? positive / directional : 0.5,
    contradictorySignals: contradictions,
    items,
  });
}

export function buildSizing(opts: {
  equityUsd: number;
  cashUsd: number;
  requestedNotionalUsd: number;
  approvedNotionalUsd: number;
}): SizingInfo {
  const equity = Math.max(0, opts.equityUsd);
  return {
    equityUsd: equity,
    cashUsd: opts.cashUsd,
    requestedNotionalUsd: opts.requestedNotionalUsd,
    approvedNotionalUsd: opts.approvedNotionalUsd,
    positionSizePct: equity > 0 ? opts.approvedNotionalUsd / equity : 0,
  };
}

export function buildExecutionAssumptions(opts: {
  latencyMs: number;
  feeBps: number;
  baseSlippageBps: number;
  model: string;
  expectedFillPrice: number;
}): ExecutionAssumptions {
  return {
    latencyMs: opts.latencyMs,
    feeBps: opts.feeBps,
    baseSlippageBps: opts.baseSlippageBps,
    model: opts.model,
    expectedFillPrice: opts.expectedFillPrice,
  };
}

export function buildDataQuality(opts: {
  priceFresh: boolean;
  dataAgeMs: number | null;
  sourceReliability: number;
  source: string | null;
  stalenessFlags: string[];
  score?: number;
  sourceConflict?: boolean;
  delayed?: boolean;
  fakeMoveSuspected?: boolean;
  learningWeight?: number;
}): DataQuality {
  return {
    priceFresh: opts.priceFresh,
    dataAgeMs: opts.dataAgeMs,
    sourceReliability: clamp(num0(opts.sourceReliability), 0, 1),
    source: opts.source,
    stalenessFlags: opts.stalenessFlags,
    score: opts.score,
    sourceConflict: opts.sourceConflict,
    delayed: opts.delayed,
    fakeMoveSuspected: opts.fakeMoveSuspected,
    learningWeight: opts.learningWeight,
  };
}

export function createDecisionSnapshot(
  ctx: DecisionContext,
  defaultLearnerVersion = "0.0.0-shadow",
): DecisionSnapshot {
  const r = ctx.ranked;
  const features: DecisionFeatures = r
    ? buildFeatures({
        score: r.score,
        confidence: r.confidence,
        components: r.components,
        rugRisk: r.rugRisk,
        change1hPct: r.asset.change1hPct,
        change24hPct: r.asset.change24hPct,
        change7dPct: r.asset.change7dPct,
        sparkline7d: r.asset.sparkline7d,
        isMajor: r.asset.kind === "major" || (r.asset.coingeckoId != null && (r.asset.marketCapUsd ?? 0) > 250_000_000),
        isDex: r.asset.kind === "dex",
      })
    : ({
        momentum: 0.5,
        liquidity: 0.5,
        volumeAnomaly: 0.5,
        marketQuality: 0.5,
        smartMoney: 0.5,
        social: 0.5,
        news: 0.5,
        riskPenalty: 0.5,
        executionPenalty: 0.5,
        score: 0.5,
        confidence: 0.5,
        rugRisk: 0.5,
        change1hPct: null,
        change24hPct: null,
        change7dPct: null,
        distFrom7dHighPct: null,
        isMajor: false,
        isDex: false,
      } as DecisionFeatures);

  const marketStructure: MarketStructure = r
    ? buildMarketStructure({
        sparkline7d: r.asset.sparkline7d,
        change24hPct: r.asset.change24hPct,
        change7dPct: r.asset.change7dPct,
      })
    : { htfTrend: "neutral", priceVs7dHigh: "mid", volatilityRegime: "low" };

  const regimeObj = ctx.regime ? (ctx.regime as { label?: string; fearGreed?: number | null }) : {};
  const actionAt = ctx.actionAt ?? nowIso();

  return {
    id: rid(),
    portfolioId: "paper-default",
    assetId: ctx.assetId,
    symbol: ctx.symbol,
    decision: ctx.decision,
    baselineAction: ctx.baselineAction ?? ctx.decision ?? null,
    side: ctx.side ?? null,
    actionAt,
    strategyId: ctx.strategyId,
    strategyVersion: ctx.strategyVersion,
    learnerVersion: defaultLearnerVersion,
    signalId: ctx.signalId ?? null,
    orderId: ctx.orderId ?? null,
    features,
    marketStructure,
    regime: regimeObj as Record<string, string | number | boolean | null>,
    evidence: evidenceFromContext(ctx, features),
    riskState: ctx.riskState ?? {
      positionPctOfEquity: 0,
      tokenConcentrationPct: 0,
      chainExposurePct: 0,
      liquidityTakePct: 0,
      slippageBps: 0,
      dailyLossUsedPct: 0,
      hardLimitsHit: [],
    },
    sizing: ctx.sizing ?? null,
    executionAssumptions: ctx.execution ?? null,
    dataQuality: ctx.dataQuality ?? buildDataQuality({ priceFresh: true, dataAgeMs: null, sourceReliability: 0.7, source: null, stalenessFlags: [] }),
    expectedValue: ctx.expectedValue ?? null,
    confidence: ctx.confidence ?? null,
    learnerRecommendation: ctx.learnerRecommendation ?? null,
    notes: ctx.notes ?? null,
    createdAt: nowIso(),
    latestMarketDataTimestamp: ctx.latestMarketDataTimestamp ?? null,
    latestNewsTimestamp: ctx.latestNewsTimestamp ?? null,
    latestSocialTimestamp: ctx.latestSocialTimestamp ?? null,
    latestEventTimestamp: ctx.latestEventTimestamp ?? null,
    analysisTimestamp: ctx.analysisTimestamp ?? actionAt,
    capitalProfile: ctx.capitalProfile ?? null,
    executableAt100: ctx.executableAt100,
    lookaheadClean: ctx.lookaheadClean ?? true,
  };
}

export function updateSnapshotEvidence(
  snapshot: DecisionSnapshot,
  evidence: EvidenceState,
  riskState: DecisionSnapshot["riskState"],
): DecisionSnapshot {
  return {
    ...snapshot,
    evidence,
    riskState,
  };
}

export function validateNoLookAhead(snapshot: DecisionSnapshot, outcomeTime: string): boolean {
  const action = new Date(snapshot.actionAt).getTime();
  const outcome = new Date(outcomeTime).getTime();
  if (!(action <= outcome)) return false;
  const checks = [
    snapshot.latestMarketDataTimestamp,
    snapshot.latestNewsTimestamp,
    snapshot.latestSocialTimestamp,
    snapshot.latestEventTimestamp,
    snapshot.analysisTimestamp,
  ];
  for (const c of checks) {
    if (!c) continue;
    const t = Date.parse(c);
    if (Number.isFinite(t) && t > action) return false;
  }
  return snapshot.lookaheadClean !== false;
}

export function actionFromIntent(side: "buy" | "sell" | undefined, passedRisk: boolean): DecisionAction {
  if (!side) return "WAIT";
  return passedRisk ? "ENTER" : "REJECT";
}
