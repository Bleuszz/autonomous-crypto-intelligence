import { decideEntries, decideExits, type OpenPosition, type RegimeInput } from "./engine.ts";
import { assessDataQuality, type DataQualityAssessment, type SourceQuote } from "./data-quality.ts";
import {
  CAPITAL_SCALES_GBP,
  classifyCapitalSensitivity,
  profileFor,
  simulateCapitalAwareFill,
  sizeForProfile,
  summariseScale,
  type CapitalProfileId,
  type FxQuote,
  type ScaleReport,
  type ScaleTrade,
} from "./capital.ts";
import { pickLatencyMs, gasForChain } from "./paper.ts";
import type { RankedOpportunity } from "./types.ts";
import { alternativeEntries, rejectCounterfactual, waitOutcome, type HypotheticalOutcome, type PricePath } from "./learning/counterfactual.ts";
import {
  assignSplit,
  correlationGroup,
  qualityWeight,
  shouldTrainOn,
  type TrainingExperience,
} from "./learning/experiences.ts";
import { clamp } from "./math.ts";

/**
 * Historical replay. At every timestamp the pipeline may only see
 * information whose observed/published time is <= decision time.
 */

export type ReplayTimestamps = {
  decisionTimestamp: number;
  latestMarketDataTimestamp: number;
  latestNewsTimestamp: number | null;
  latestSocialTimestamp: number | null;
  latestEventTimestamp: number | null;
  analysisTimestamp: number;
};

export type ReplayNews = { publishedAt: number; title: string; sentiment?: number | null };
export type ReplaySocial = { publishedAt: number; body: string };
export type ReplayEvent = { publishedAt: number; detectedAt: number; eventType: string; impactScore: number; affectedAssets?: string[] };

export type ReplayAssetBar = {
  assetId: string;
  symbol: string;
  kind: string;
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  liquidityUsd: number;
  quotes?: SourceQuote[];
};

export type ReplayFrame = {
  t: number;
  assets: ReplayAssetBar[];
  news: ReplayNews[];
  social: ReplaySocial[];
  events: ReplayEvent[];
  regime: RegimeInput;
};

export type LookaheadViolation = {
  field: keyof ReplayTimestamps | "future_candle" | "revised_print";
  decisionTimestamp: number;
  offendingTimestamp: number;
  detail: string;
};

export function asOfFrame(frame: ReplayFrame, t: number): ReplayFrame {
  return {
    t,
    regime: frame.regime,
    assets: frame.assets.filter((a) => a.t <= t),
    news: frame.news.filter((n) => n.publishedAt <= t),
    social: frame.social.filter((s) => s.publishedAt <= t),
    events: frame.events.filter((e) => Math.min(e.publishedAt, e.detectedAt) <= t),
  };
}

export function timestampsFor(frame: ReplayFrame, analysisTimestamp: number): ReplayTimestamps {
  const market = frame.assets.reduce((m, a) => Math.max(m, a.t), 0);
  const news = frame.news.reduce((m, n) => Math.max(m, n.publishedAt), 0);
  const social = frame.social.reduce((m, s) => Math.max(s.publishedAt, m), 0);
  const events = frame.events.reduce((m, e) => Math.max(m, e.detectedAt, e.publishedAt), 0);
  return {
    decisionTimestamp: frame.t,
    latestMarketDataTimestamp: market || frame.t,
    latestNewsTimestamp: news || null,
    latestSocialTimestamp: social || null,
    latestEventTimestamp: events || null,
    analysisTimestamp,
  };
}

export function detectLookahead(ts: ReplayTimestamps): LookaheadViolation[] {
  const out: LookaheadViolation[] = [];
  const t = ts.decisionTimestamp;
  const check = (field: keyof ReplayTimestamps, value: number | null, label: string) => {
    if (value != null && value > t) {
      out.push({
        field,
        decisionTimestamp: t,
        offendingTimestamp: value,
        detail: `${label} timestamp ${new Date(value).toISOString()} is after decision ${new Date(t).toISOString()}`,
      });
    }
  };
  check("latestMarketDataTimestamp", ts.latestMarketDataTimestamp, "Market data");
  check("latestNewsTimestamp", ts.latestNewsTimestamp, "News");
  check("latestSocialTimestamp", ts.latestSocialTimestamp, "Social");
  check("latestEventTimestamp", ts.latestEventTimestamp, "Event");
  check("analysisTimestamp", ts.analysisTimestamp, "Analysis");
  return out;
}

export function injectFutureAndDetect(opts: {
  frame: ReplayFrame;
  decisionT: number;
  futureNews?: ReplayNews;
  futureBar?: ReplayAssetBar;
  futureSocial?: ReplaySocial;
  futureEvent?: ReplayEvent;
}): LookaheadViolation[] {
  const sliced = asOfFrame(opts.frame, opts.decisionT);
  const polluted: ReplayFrame = {
    ...sliced,
    news: opts.futureNews ? [...sliced.news, opts.futureNews] : sliced.news,
    assets: opts.futureBar ? [...sliced.assets, opts.futureBar] : sliced.assets,
    social: opts.futureSocial ? [...sliced.social, opts.futureSocial] : sliced.social,
    events: opts.futureEvent ? [...sliced.events, opts.futureEvent] : sliced.events,
  };
  const extra: LookaheadViolation[] = [];
  if (opts.futureBar && opts.futureBar.t > opts.decisionT) {
    extra.push({
      field: "future_candle",
      decisionTimestamp: opts.decisionT,
      offendingTimestamp: opts.futureBar.t,
      detail: `Future candle at ${new Date(opts.futureBar.t).toISOString()} injected into decision ${new Date(opts.decisionT).toISOString()}`,
    });
  }
  return [...detectLookahead(timestampsFor(polluted, opts.decisionT)), ...extra];
}

export type ReplayDecision = {
  t: number;
  assetId: string;
  symbol: string;
  decision: "ENTER" | "WAIT" | "REJECT" | "EXIT";
  reason: string;
  timestamps: ReplayTimestamps;
  lookaheadViolations: LookaheadViolation[];
  quality: DataQualityAssessment | null;
  executableAt100: boolean;
  rejectedFill: string | null;
  confidence?: number;
  kind?: string;
};

export type ReplayResult = {
  decisions: ReplayDecision[];
  fills: number;
  rejected: number;
  waits: number;
  lookaheadFailures: number;
  notes: string;
};

function rankedFromBar(bar: ReplayAssetBar, prev: ReplayAssetBar | null, nowMs: number): RankedOpportunity {
  const change1h = prev && prev.close > 0 ? ((bar.close - prev.close) / prev.close) * 100 : 0;
  return {
    asset: {
      id: bar.assetId,
      symbol: bar.symbol,
      name: bar.symbol,
      kind: bar.kind,
      chainId: null,
      contractAddress: null,
      coingeckoId: bar.assetId.replace(/^cg:/, ""),
      imageUrl: null,
      priceUsd: bar.close,
      marketCapUsd: null,
      fdvUsd: null,
      volume24hUsd: bar.volume,
      liquidityUsd: bar.liquidityUsd,
      change1hPct: change1h,
      change24hPct: change1h,
      change7dPct: null,
      pairCreatedAt: null,
      sparkline7d: prev ? [prev.close, bar.close, bar.close, bar.close, bar.close, bar.close, bar.close, bar.close] : [bar.close, bar.close, bar.close, bar.close, bar.close, bar.close, bar.close, bar.close],
      source: "replay",
      sourceReliability: 0.7,
      observedAt: new Date(bar.t).toISOString(),
      ingestedAt: new Date(nowMs).toISOString(),
      dataAgeMs: Math.max(0, nowMs - bar.t),
    },
    score: 0.55,
    confidence: 0.55,
    rugRisk: 0.1,
    components: {
      marketQuality: 0.6,
      liquidity: 0.6,
      momentum: change1h > 0 ? 0.6 : 0.4,
      volumeAnomaly: 0.3,
      smartMoney: 0.1,
      social: 0.1,
      news: 0.1,
      riskPenalty: 0.1,
      executionPenalty: 0,
    },
    reasons: ["replay frame"],
    riskReasons: [],
  };
}

function qualityFor(bar: ReplayAssetBar, asOf: ReplayFrame, r: RankedOpportunity, t: number, delay: number): DataQualityAssessment {
  return assessDataQuality({
    assetId: bar.assetId,
    symbol: bar.symbol,
    kind: bar.kind,
    primaryPriceUsd: bar.close,
    primarySource: "replay",
    primaryObservedAt: new Date(bar.t).toISOString(),
    dataAgeMs: delay,
    volume24hUsd: bar.volume,
    liquidityUsd: bar.liquidityUsd,
    change1hPct: r.asset.change1hPct,
    change24hPct: r.asset.change24hPct,
    quotes: bar.quotes ?? [{ source: "replay", priceUsd: bar.close, observedAt: new Date(bar.t).toISOString() }],
    news: asOf.news.map((n) => ({ publishedAt: new Date(n.publishedAt).toISOString(), title: n.title })),
    events: asOf.events.map((e) => ({
      publishedAt: new Date(e.publishedAt).toISOString(),
      observedAt: new Date(e.detectedAt).toISOString(),
      eventType: e.eventType,
      impactScore: e.impactScore,
      affectedAssets: e.affectedAssets,
    })),
    nowMs: t,
  });
}

/**
 * Replay a sequence of frames as if live. Future information is stripped per frame.
 * delayMs > 0 models a delayed-data desk (marks arrive late). A strategy that
 * only works with delayMs = 0 is invalid for promotion.
 *
 * WAIT is recorded for every considered asset that is not ENTER. REJECT is
 * recorded when quality/capital/fill gates fire. Trades are never invented
 * solely to pad the training set.
 */
export function runReplay(opts: {
  frames: ReplayFrame[];
  delayMs?: number;
  capitalProfile?: CapitalProfileId;
  fx?: FxQuote | null;
  nowAnalysisOffsetMs?: number;
}): ReplayResult {
  const delay = opts.delayMs ?? 0;
  const profile = profileFor(opts.capitalProfile ?? "research");
  const fx = opts.fx ?? null;
  const decisions: ReplayDecision[] = [];
  const held = new Set<string>();
  const positions: OpenPosition[] = [];
  const prevByAsset = new Map<string, ReplayAssetBar>();
  let fills = 0;
  let rejected = 0;
  let waits = 0;
  let lookaheadFailures = 0;

  for (const raw of opts.frames) {
    const t = raw.t;
    const asOf = asOfFrame(raw, t);
    if (delay > 0) {
      asOf.assets = asOf.assets.filter((a) => a.t <= t - delay);
    }
    const analysisTimestamp = t + (opts.nowAnalysisOffsetMs ?? 0);
    const ts = timestampsFor({ ...asOf, t }, analysisTimestamp);
    const violations = detectLookahead(ts);
    lookaheadFailures += violations.length;

    const ranked: RankedOpportunity[] = asOf.assets.map((bar) => {
      const prev = prevByAsset.get(bar.assetId) ?? null;
      return rankedFromBar(bar, prev, t);
    });
    for (const bar of asOf.assets) prevByAsset.set(bar.assetId, bar);

    const exits = decideExits({ positions, ranked, signals: [], regime: asOf.regime, now: t });
    for (const ex of exits) {
      decisions.push({
        t,
        assetId: ex.assetId,
        symbol: ex.symbol,
        decision: "EXIT",
        reason: ex.reason,
        timestamps: ts,
        lookaheadViolations: violations,
        quality: null,
        executableAt100: true,
        rejectedFill: null,
      });
      const idx = positions.findIndex((p) => p.assetId === ex.assetId);
      if (idx >= 0) positions.splice(idx, 1);
      held.delete(ex.assetId);
    }

    const entries = decideEntries({
      ranked,
      signals: [],
      held,
      regime: asOf.regime,
      openCount: positions.length,
    });
    const entryIds = new Set(entries.map((e) => e.assetId));

    for (const intent of entries) {
      const bar = asOf.assets.find((a) => a.assetId === intent.assetId);
      const r = ranked.find((x) => x.asset.id === intent.assetId);
      if (!bar || !r) continue;
      const q = qualityFor(bar, asOf, r, t, delay);
      if (q.blockEntry) {
        rejected++;
        decisions.push({
          t, assetId: intent.assetId, symbol: intent.symbol, decision: "REJECT",
          reason: q.blockReason ?? "quality",
          timestamps: ts, lookaheadViolations: violations, quality: q,
          executableAt100: false, rejectedFill: q.blockReason, confidence: intent.confidence, kind: bar.kind,
        });
        continue;
      }
      const sized = sizeForProfile({
        profile,
        equityGbp: profile.equityGbp,
        cashGbp: profile.equityGbp * 0.7,
        confidence: intent.confidence,
        liquidityUsd: bar.liquidityUsd,
        volume24hUsd: bar.volume,
        fx,
        volatilityPct: Math.abs(r.asset.change24hPct ?? 5),
        historicalReliability: 0.55,
      });
      if (!sized.ok || sized.notionalUsd == null) {
        rejected++;
        decisions.push({
          t, assetId: intent.assetId, symbol: intent.symbol, decision: "REJECT",
          reason: sized.rejectReason ?? "capital",
          timestamps: ts, lookaheadViolations: violations, quality: q,
          executableAt100: sized.executableAt100, rejectedFill: sized.rejectReason, confidence: intent.confidence, kind: bar.kind,
        });
        continue;
      }
      const fill = simulateCapitalAwareFill({
        profile,
        notionalUsd: sized.notionalUsd,
        volume24hUsd: bar.volume,
        fill: {
          side: "buy",
          mid: bar.close,
          liquidityUsd: bar.liquidityUsd,
          volatilityPct: Math.abs(r.asset.change24hPct ?? 5),
          latencyMs: pickLatencyMs(intent.strategyId + intent.assetId),
          gasUsd: gasForChain(null),
          seed: `replay:${intent.assetId}:${t}`,
        },
      });
      if (!fill.ok) {
        rejected++;
        decisions.push({
          t, assetId: intent.assetId, symbol: intent.symbol, decision: "REJECT",
          reason: fill.rejectReason ?? "fill",
          timestamps: ts, lookaheadViolations: violations, quality: q,
          executableAt100: sized.executableAt100, rejectedFill: fill.rejectReason, confidence: intent.confidence, kind: bar.kind,
        });
        continue;
      }
      fills++;
      held.add(intent.assetId);
      positions.push({
        id: `${intent.assetId}:${t}`,
        assetId: intent.assetId,
        qty: fill.qty,
        avgPrice: fill.price,
        openedAt: new Date(t).toISOString(),
        peakMark: fill.price,
      });
      decisions.push({
        t, assetId: intent.assetId, symbol: intent.symbol, decision: "ENTER",
        reason: intent.reason,
        timestamps: ts, lookaheadViolations: violations, quality: q,
        executableAt100: sized.executableAt100, rejectedFill: null, confidence: intent.confidence, kind: bar.kind,
      });
    }

    for (const r of ranked) {
      if (held.has(r.asset.id) || entryIds.has(r.asset.id)) continue;
      const bar = asOf.assets.find((a) => a.assetId === r.asset.id);
      const q = bar ? qualityFor(bar, asOf, r, t, delay) : null;
      const reject = Boolean(q?.blockEntry);
      if (reject) rejected++;
      else waits++;
      decisions.push({
        t,
        assetId: r.asset.id,
        symbol: r.asset.symbol,
        decision: reject ? "REJECT" : "WAIT",
        reason: reject ? (q?.blockReason ?? "quality") : "Considered, not selected — WAIT is a real decision",
        timestamps: ts,
        lookaheadViolations: violations,
        quality: q,
        executableAt100: false,
        rejectedFill: reject ? q?.blockReason ?? null : null,
        confidence: r.confidence,
        kind: bar?.kind,
      });
    }
  }

  return {
    decisions,
    fills,
    rejected,
    waits,
    lookaheadFailures,
    notes: lookaheadFailures
      ? `LOOKAHEAD VIOLATIONS: ${lookaheadFailures}`
      : "Replay completed with as-of information only.",
  };
}

/** Compare instant vs delayed replay. Instant-only edge is invalid. */
export function delayedDataInvalidates(instant: ReplayResult, delayed: ReplayResult): {
  invalid: boolean;
  reason: string;
} {
  if (instant.fills === 0) {
    return { invalid: false, reason: "INSUFFICIENT EVIDENCE: no instant fills to compare." };
  }
  if (instant.fills > 0 && delayed.fills === 0) {
    return { invalid: true, reason: "Strategy only fills with instantaneous data — invalid under delayed-data discipline." };
  }
  const instantEnter = instant.decisions.filter((d) => d.decision === "ENTER").length;
  const delayedEnter = delayed.decisions.filter((d) => d.decision === "ENTER").length;
  if (instantEnter >= 5 && delayedEnter / instantEnter < 0.3) {
    return { invalid: true, reason: "Entry count collapses once marks are delayed. Not promotion-ready." };
  }
  return { invalid: false, reason: "Delayed-data replay still produces comparable activity." };
}

/** Path of an asset strictly at or after t0. Never uses earlier (or later-than-window) prints for the decision itself. */
export function pathOnOrAfter(frames: ReplayFrame[], assetId: string, t0: number): PricePath[] {
  const out: PricePath[] = [];
  for (const f of frames) {
    if (f.t < t0) continue;
    const bar = f.assets.find((a) => a.assetId === assetId);
    if (bar && bar.close > 0) out.push({ t: f.t, px: bar.close });
  }
  return out;
}

export type SettledDecision = ReplayDecision & {
  outcome: HypotheticalOutcome | null;
  altEntries: HypotheticalOutcome[];
  negativeExample: boolean;
  rewardProxy: number | null;
  lookaheadClean: boolean;
};

/**
 * Reveal outcomes using only prices at or after the decision clock.
 * ENTER uses the subsequent path as a hypothetical hold; WAIT/REJECT get
 * counterfactuals. This is the training loop's "advance time" step.
 */
export function settleReplayDecisions(frames: ReplayFrame[], decisions: ReplayDecision[], holdMs = 4 * 24 * 3600_000): SettledDecision[] {
  return decisions.map((d) => {
    const lookaheadClean = d.lookaheadViolations.length === 0 && d.timestamps.analysisTimestamp <= d.timestamps.decisionTimestamp;
    const path = pathOnOrAfter(frames, d.assetId, d.t);
    let outcome: HypotheticalOutcome | null = null;
    let altEntries: HypotheticalOutcome[] = [];
    if (d.decision === "WAIT") {
      outcome = waitOutcome({ path, decisionT: d.t, holdMs });
      altEntries = alternativeEntries({ path, decisionT: d.t, holdMs });
    } else if (d.decision === "REJECT") {
      outcome = rejectCounterfactual({ path, decisionT: d.t, holdMs });
      altEntries = alternativeEntries({ path, decisionT: d.t, holdMs });
    } else if (d.decision === "ENTER") {
      outcome = waitOutcome({ path, decisionT: d.t, holdMs });
      outcome = { ...outcome, kind: "WAIT", label: "enter_hold", entered: true, notes: outcome.notes.replace(/^WAIT/, "ENTER hold") };
      altEntries = alternativeEntries({ path, decisionT: d.t, holdMs });
    }
    const pnl = outcome?.pnlPct ?? null;
    const negative =
      (d.decision === "ENTER" && pnl != null && pnl < 0) ||
      (d.decision === "WAIT" && (outcome?.avoidedLossPct ?? 0) > 0) ||
      (d.decision === "REJECT" && pnl != null && pnl < 0) ||
      Boolean(d.quality?.fakeMoveSuspected);
    const rewardProxy = pnl == null ? null : clamp(pnl / 10, -1, 1);
    return { ...d, outcome, altEntries, negativeExample: negative, rewardProxy, lookaheadClean };
  });
}

export function regimeFromReturns(retN: number, vol: number): RegimeInput {
  let label = "Mixed";
  if (retN <= -18) label = "Crash";
  else if (retN <= -8) label = "Bear";
  else if (retN >= 12) label = "Bull";
  else if (Math.abs(retN) < 3 && vol < 2) label = "Quiet";
  else if (vol >= 5) label = "High-vol";
  else if (Math.abs(retN) < 4) label = "Sideways";
  return { fearGreed: null, btcChange24h: retN, ethChange24h: null, btcFundingPct: null, label };
}

export type CandleLike = { t: number; open: number; high: number; low: number; close: number; volume: number };

/**
 * Convert venue candles into as-of frames. Decision time is bar CLOSE
 * (interval start + intervalMs) so the close is information that existed
 * then — using close at interval-start would be look-ahead.
 */
export function framesFromCandles(opts: {
  series: Array<{ assetId: string; symbol: string; kind?: string; liquidityUsd?: number; candles: CandleLike[] }>;
  news?: ReplayNews[];
  social?: ReplaySocial[];
  events?: ReplayEvent[];
}): ReplayFrame[] {
  const byT = new Map<number, ReplayAssetBar[]>();
  for (const s of opts.series) {
    const cs = s.candles.filter((c) => c.close > 0).sort((a, b) => a.t - b.t);
    if (cs.length < 2) continue;
    const intervalMs = Math.max(60_000, cs[1]!.t - cs[0]!.t);
    for (const c of cs) {
      const closeT = c.t + intervalMs;
      const list = byT.get(closeT) ?? [];
      list.push({
        assetId: s.assetId,
        symbol: s.symbol,
        kind: s.kind ?? "major",
        t: closeT,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        liquidityUsd: s.liquidityUsd ?? Math.max(c.volume * 8, 5_000_000),
        quotes: [{ source: "kraken", priceUsd: c.close, observedAt: new Date(closeT).toISOString() }],
      });
      byT.set(closeT, list);
    }
  }
  const times = [...byT.keys()].sort((a, b) => a - b);
  const frames: ReplayFrame[] = [];
  const closes: number[] = [];
  for (const t of times) {
    const assets = byT.get(t)!;
    const px = assets[0]?.close ?? 0;
    closes.push(px);
    const look = closes.slice(-20);
    const ret = look.length >= 2 && look[0]! > 0 ? ((look[look.length - 1]! - look[0]!) / look[0]!) * 100 : 0;
    const rets = [];
    for (let i = 1; i < look.length; i++) {
      if (look[i - 1]! > 0) rets.push(Math.abs((look[i]! - look[i - 1]!) / look[i - 1]!) * 100);
    }
    const vol = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
    frames.push({
      t,
      assets,
      news: (opts.news ?? []).filter((n) => n.publishedAt <= t),
      social: (opts.social ?? []).filter((s) => s.publishedAt <= t),
      events: (opts.events ?? []).filter((e) => Math.min(e.publishedAt, e.detectedAt) <= t),
      regime: regimeFromReturns(ret, vol),
    });
  }
  return frames;
}

export function experiencesFromSettled(opts: {
  settled: SettledDecision[];
  capitalProfile: CapitalProfileId;
  range: { start: number; end: number };
  equityGbp: number;
}): TrainingExperience[] {
  const profile = profileFor(opts.capitalProfile);
  return opts.settled
    .filter((d) => d.decision === "ENTER" || d.decision === "WAIT" || d.decision === "REJECT")
    .map((d, i) => {
      const split = assignSplit(d.t, opts.range);
      const dq = d.quality?.score ?? 50;
      const lookaheadClean = d.lookaheadClean;
      const exp: TrainingExperience = {
        id: `rpx:${d.assetId}:${d.t}:${d.decision}:${i}`,
        capitalProfile: opts.capitalProfile,
        startingEquityGbp: opts.equityGbp,
        availableEquityGbp: opts.equityGbp * 0.7,
        positionSizeGbp: d.decision === "ENTER" ? profile.equityGbp * 0.02 : null,
        portfolioExposurePct: d.decision === "ENTER" ? 0.02 : 0,
        capitalUtilisationPct: d.decision === "ENTER" ? 0.4 : 0,
        regime: "unknown",
        asset: d.symbol,
        assetClass: d.kind ?? "major",
        marketStructure: "mid",
        signalType: "replay",
        dataQuality: dq,
        sourceConflict: Boolean(d.quality?.sourceConflict),
        eventClusterId: null,
        decisionTimestamp: new Date(d.t).toISOString(),
        latestMarketDataTimestamp: new Date(d.timestamps.latestMarketDataTimestamp).toISOString(),
        latestNewsTimestamp: d.timestamps.latestNewsTimestamp ? new Date(d.timestamps.latestNewsTimestamp).toISOString() : null,
        latestSocialTimestamp: d.timestamps.latestSocialTimestamp ? new Date(d.timestamps.latestSocialTimestamp).toISOString() : null,
        latestEventTimestamp: d.timestamps.latestEventTimestamp ? new Date(d.timestamps.latestEventTimestamp).toISOString() : null,
        analysisTimestamp: new Date(d.timestamps.analysisTimestamp).toISOString(),
        decision: d.decision,
        confidence: d.confidence ?? null,
        executableAt100: d.executableAt100,
        minimumRequiredCapitalGbp: null,
        capitalSensitivity: "UNKNOWN",
        outcome: d.outcome?.notes ?? "open",
        reward: d.rewardProxy,
        learningWeight: lookaheadClean ? qualityWeight(dq, Boolean(d.quality?.sourceConflict), Boolean(d.quality?.fakeMoveSuspected)) : 0,
        split,
        usedForTraining: false,
        correlationGroup: correlationGroup(d.symbol, "unknown"),
        lookaheadClean,
        negativeExample: d.negativeExample,
        historicalReplay: true,
        assetState: "ACTIVE",
      };
      exp.usedForTraining = shouldTrainOn(exp).ok;
      return exp;
    });
}

export function scaleReportsFromSettled(settled: SettledDecision[], fx: FxQuote | null): ScaleReport[] {
  const enters = settled.filter((d) => d.decision === "ENTER" && d.lookaheadClean);
  return CAPITAL_SCALES_GBP.map((gbp) => {
    const trades: ScaleTrade[] = enters.map((d) => {
      const sized = sizeForProfile({
        profile: {
          ...profileFor(gbp >= 50_000 ? "research" : "realistic"),
          equityGbp: gbp,
          minOrderGbp: gbp >= 50_000 ? 60 : 8,
        },
        equityGbp: gbp,
        cashGbp: gbp * 0.8,
        confidence: d.confidence ?? 0.55,
        liquidityUsd: d.quality ? 5_000_000 : 5_000_000,
        volume24hUsd: 20_000_000,
        fx,
        volatilityPct: 5,
      });
      if (!sized.ok) {
        return { returnPct: 0, pnlGbp: 0, feesGbp: 0, slippageBps: 0, notionalGbp: 0, rejected: true };
      }
      const pnlPct = d.outcome?.pnlPct ?? 0;
      return {
        returnPct: pnlPct,
        pnlGbp: (sized.notionalGbp * pnlPct) / 100,
        feesGbp: sized.notionalGbp * 0.003,
        slippageBps: 12,
        notionalGbp: sized.notionalGbp,
        rejected: false,
      };
    });
    return summariseScale(gbp, trades);
  });
}

export type ReplayTrainingResult = {
  replay: ReplayResult;
  settled: SettledDecision[];
  experiences: TrainingExperience[];
  counterfactuals: Array<{ experienceId: string; outcome: HypotheticalOutcome }>;
  scaleReports: ScaleReport[];
  classification: ReturnType<typeof classifyCapitalSensitivity>;
  droppedLookahead: number;
  notes: string;
};

export function runReplayTraining(opts: {
  frames: ReplayFrame[];
  delayMs?: number;
  capitalProfile?: CapitalProfileId;
  fx?: FxQuote | null;
}): ReplayTrainingResult {
  const profile = opts.capitalProfile ?? "research";
  const replay = runReplay({
    frames: opts.frames,
    delayMs: opts.delayMs ?? 0,
    capitalProfile: profile,
    fx: opts.fx ?? null,
  });
  const settled = settleReplayDecisions(opts.frames, replay.decisions);
  const droppedLookahead = settled.filter((s) => !s.lookaheadClean).length;
  const times = opts.frames.map((f) => f.t);
  const range = { start: times[0] ?? 0, end: times[times.length - 1] ?? 1 };
  const experiences = experiencesFromSettled({
    settled: settled.filter((s) => s.lookaheadClean),
    capitalProfile: profile,
    range,
    equityGbp: profileFor(profile).equityGbp,
  });
  const counterfactuals: Array<{ experienceId: string; outcome: HypotheticalOutcome }> = [];
  for (const exp of experiences) {
    const s = settled.find((x) => exp.id.startsWith(`rpx:${x.assetId}:${x.t}:${x.decision}`));
    if (!s) continue;
    if (s.outcome) counterfactuals.push({ experienceId: exp.id, outcome: s.outcome });
    for (const alt of s.altEntries) counterfactuals.push({ experienceId: exp.id, outcome: alt });
  }
  const scaleReports = scaleReportsFromSettled(settled, opts.fx ?? null);
  const classification = classifyCapitalSensitivity(scaleReports);
  return {
    replay,
    settled,
    experiences,
    counterfactuals,
    scaleReports,
    classification,
    droppedLookahead,
    notes: droppedLookahead
      ? `Dropped ${droppedLookahead} lookahead-dirty examples from training.`
      : replay.notes,
  };
}
