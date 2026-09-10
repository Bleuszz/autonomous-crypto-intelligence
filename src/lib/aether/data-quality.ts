import { SOURCE_RELIABILITY, PRICE_TRADE_STALE_MS } from "./config.ts";
import { clamp, mean, num0 } from "./math.ts";

/** Independent quotes of the same asset. One source is never treated as truth. */
export type SourceQuote = {
  source: string;
  priceUsd: number;
  observedAt: string;
  volume24hUsd?: number | null;
  reliability?: number;
};

export type QualityNews = {
  publishedAt: string | null;
  title: string;
  sentiment?: number | null;
};

export type QualityEvent = {
  publishedAt: string | null;
  observedAt: string;
  eventType: string;
  impactScore: number;
  affectedAssets?: string[];
};

export type ConflictType =
  | "price_disagreement"
  | "stale_vs_fresh"
  | "volume_disagreement"
  | "direction_disagreement";

export type ConflictSeverity = "low" | "medium" | "high";

export type SourceConflict = {
  sourceConflict: true;
  conflictingSources: string[];
  conflictType: ConflictType;
  conflictSeverity: ConflictSeverity;
  details: string;
};

export type DataQualityInput = {
  assetId: string;
  symbol: string;
  kind: string;
  primaryPriceUsd: number;
  primarySource: string | null;
  primaryObservedAt: string | null;
  dataAgeMs: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  change1hPct: number | null;
  change24hPct: number | null;
  quotes: SourceQuote[];
  news?: QualityNews[];
  events?: QualityEvent[];
  nowMs?: number;
};

export type DataQualityComponents = {
  sourceReliability: number;
  freshness: number;
  timestampAccuracy: number;
  completeness: number;
  sourceAgreement: number;
  delayedDataPenalty: number;
  stalePenalty: number;
  fakeMovePenalty: number;
  eventConfirmation: number;
  newsConfirmation: number;
};

export type DataQualityAssessment = {
  assetId: string;
  symbol: string;
  score: number;
  components: DataQualityComponents;
  flags: string[];
  sourceConflict: boolean;
  conflictingSources: string[];
  conflictType: ConflictType | null;
  conflictSeverity: ConflictSeverity | null;
  conflictDetails: string | null;
  delayed: boolean;
  stale: boolean;
  fakeMoveSuspected: boolean;
  washTradeSuspected: boolean;
  eventConfirmed: boolean | null;
  newsConfirmed: boolean | null;
  blockEntry: boolean;
  blockReason: string | null;
  learningWeight: number;
  quoteCount: number;
  spreadBps: number | null;
};

export const DATA_QUALITY_MIN_ENTRY = 55;
export const DATA_QUALITY_MIN_LEARNING_WEIGHT = 0.25;
const MAJOR_DISAGREE_BPS = 50;
const DEX_DISAGREE_BPS = 200;
const DELAYED_MS = 3 * 60_000;

export function reliabilityOf(source: string | null | undefined): number {
  if (!source) return 0.4;
  return SOURCE_RELIABILITY[source] ?? 0.45;
}

export function quoteSpreadBps(quotes: SourceQuote[]): number | null {
  const px = quotes.map((q) => q.priceUsd).filter((p) => p > 0);
  if (px.length < 2) return null;
  const hi = Math.max(...px);
  const lo = Math.min(...px);
  const mid = (hi + lo) / 2;
  if (!(mid > 0)) return null;
  return ((hi - lo) / mid) * 10_000;
}

export function sourceAgreementScore(quotes: SourceQuote[], kind: string): {
  score: number;
  conflict: SourceConflict | null;
  spreadBps: number | null;
} {
  const usable = quotes.filter((q) => q.priceUsd > 0);
  if (usable.length < 2) {
    return {
      score: usable.length === 1 ? 55 : 30,
      conflict: null,
      spreadBps: null,
    };
  }
  const spread = quoteSpreadBps(usable) ?? 0;
  const threshold = kind === "dex" ? DEX_DISAGREE_BPS : MAJOR_DISAGREE_BPS;
  let score = 100;
  if (spread <= threshold * 0.4) score = 100;
  else if (spread <= threshold) score = 80;
  else if (spread <= threshold * 2) score = 50;
  else if (spread <= threshold * 4) score = 25;
  else score = 8;

  if (spread <= threshold) {
    return { score, conflict: null, spreadBps: spread };
  }
  const severity: ConflictSeverity = spread > threshold * 4 ? "high" : spread > threshold * 2 ? "medium" : "low";
  return {
    score,
    spreadBps: spread,
    conflict: {
      sourceConflict: true,
      conflictingSources: [...new Set(usable.map((q) => q.source))],
      conflictType: "price_disagreement",
      conflictSeverity: severity,
      details: `Cross-source spread ${spread.toFixed(1)} bps exceeds ${threshold} bps ${kind} threshold`,
    },
  };
}

export function freshnessScore(dataAgeMs: number | null, staleMs = PRICE_TRADE_STALE_MS): {
  score: number;
  delayed: boolean;
  stale: boolean;
  delayedPenalty: number;
  stalePenalty: number;
} {
  if (dataAgeMs == null || !Number.isFinite(dataAgeMs) || dataAgeMs < 0) {
    return { score: 35, delayed: true, stale: false, delayedPenalty: 20, stalePenalty: 0 };
  }
  const delayed = dataAgeMs > DELAYED_MS;
  const stale = dataAgeMs > staleMs;
  let score = 100;
  if (dataAgeMs <= 30_000) score = 100;
  else if (dataAgeMs <= DELAYED_MS) score = 90;
  else if (dataAgeMs <= staleMs) score = 65;
  else if (dataAgeMs <= staleMs * 2) score = 30;
  else score = 8;
  const delayedPenalty = delayed ? clamp((dataAgeMs - DELAYED_MS) / staleMs, 0, 1) * 40 : 0;
  const stalePenalty = stale ? clamp((dataAgeMs - staleMs) / staleMs, 0, 1) * 50 : 0;
  return { score, delayed, stale, delayedPenalty, stalePenalty };
}

/**
 * Fake-move / wash-trade heuristic. Never claims certainty.
 * Flags: vertical print vs thin book, volume without multi-source confirmation,
 * 1h move that dwarfs 24h without quote agreement.
 */
export function detectFakeMove(input: DataQualityInput, agreement: number, quoteCount: number): {
  fakeMove: boolean;
  wash: boolean;
  penalty: number;
  flags: string[];
} {
  const flags: string[] = [];
  let penalty = 0;
  const h1 = Math.abs(num0(input.change1hPct));
  const d24 = Math.abs(num0(input.change24hPct));
  const liq = num0(input.liquidityUsd);
  const vol = num0(input.volume24hUsd);
  const thin = input.kind === "dex" && liq > 0 && liq < 250_000;
  const vertical = h1 >= 12 || d24 >= 35;
  const unconfirmed = quoteCount < 2 || agreement < 40;

  if (vertical && unconfirmed) {
    flags.push("unconfirmed_vertical_print");
    penalty += 35;
  }
  if (vertical && thin) {
    flags.push("thin_book_vertical_print");
    penalty += 25;
  }
  if (h1 >= 8 && d24 > 0 && h1 > d24 * 0.85 && unconfirmed) {
    flags.push("1h_move_not_cross_confirmed");
    penalty += 15;
  }
  const wash = vol > 0 && liq > 0 && vol / Math.max(liq, 1) > 40 && h1 < 0.4 && unconfirmed;
  if (wash) {
    flags.push("wash_volume_suspect");
    penalty += 20;
  }
  if (input.kind === "dex" && vol > 0 && liq > 0 && vol > liq * 8 && d24 >= 18 && unconfirmed) {
    flags.push("possible_pump");
    penalty += 20;
  }
  return {
    fakeMove: flags.includes("unconfirmed_vertical_print") || flags.includes("possible_pump") || flags.includes("thin_book_vertical_print"),
    wash,
    penalty: clamp(penalty, 0, 70),
    flags,
  };
}

function eventConfirmation(input: DataQualityInput, nowMs: number): { score: number; confirmed: boolean | null } {
  const events = (input.events ?? []).filter((e) => {
    const t = Date.parse(e.publishedAt ?? e.observedAt);
    if (!Number.isFinite(t) || t > nowMs) return false;
    if (e.affectedAssets && e.affectedAssets.length && !e.affectedAssets.includes(input.assetId) && !e.affectedAssets.includes(input.symbol)) {
      return false;
    }
    return nowMs - t <= 6 * 3600_000 && e.impactScore >= 0.35;
  });
  if (!events.length) return { score: 50, confirmed: null };
  const d24 = num0(input.change24hPct);
  const h1 = num0(input.change1hPct);
  const bullish = events.some((e) => /list|etf|upgrade|partnership|approval/i.test(e.eventType));
  const bearish = events.some((e) => /hack|exploit|rug|halt|delist|lawsuit/i.test(e.eventType));
  if (bullish && (h1 > 0.2 || d24 > 0.5)) return { score: 80, confirmed: true };
  if (bearish && (h1 < -0.2 || d24 < -0.5)) return { score: 80, confirmed: true };
  if (bullish && h1 < -0.15 && d24 < 0) return { score: 35, confirmed: false };
  if (bearish && h1 > 0.15 && d24 > 0) return { score: 35, confirmed: false };
  return { score: 45, confirmed: false };
}

function newsConfirmation(input: DataQualityInput, nowMs: number): { score: number; confirmed: boolean | null } {
  const news = (input.news ?? []).filter((n) => {
    if (!n.publishedAt) return false;
    const t = Date.parse(n.publishedAt);
    return Number.isFinite(t) && t <= nowMs && nowMs - t <= 8 * 3600_000;
  });
  if (!news.length) return { score: 50, confirmed: null };
  const d24 = num0(input.change24hPct);
  const h1 = num0(input.change1hPct);
  const bull = news.filter((n) => /\b(etf|lists|listing|approved|upgrade|partnership|buyback)\b/i.test(n.title)).length;
  const bear = news.filter((n) => /\b(hack|exploit|rug|halted|delist|lawsuit|insolvent|breach)\b/i.test(n.title)).length;
  if (!bull && !bear) return { score: 50, confirmed: null };
  if (bull > bear && (h1 > 0.15 || d24 > 0.4)) return { score: 75, confirmed: true };
  if (bear > bull && (h1 < -0.15 || d24 < -0.4)) return { score: 75, confirmed: true };
  if (bull > bear && h1 < -0.2) return { score: 30, confirmed: false };
  if (bear > bull && h1 > 0.2) return { score: 30, confirmed: false };
  return { score: 42, confirmed: false };
}

function completenessScore(input: DataQualityInput): number {
  const fields = [
    input.primaryPriceUsd > 0,
    input.primaryObservedAt != null,
    input.volume24hUsd != null && input.volume24hUsd > 0,
    input.liquidityUsd != null || input.kind === "major",
    input.change24hPct != null,
    input.quotes.length >= 1,
    input.primarySource != null,
  ];
  return (fields.filter(Boolean).length / fields.length) * 100;
}

function timestampAccuracy(quotes: SourceQuote[], nowMs: number): number {
  if (!quotes.length) return 40;
  const ages = quotes.map((q) => {
    const t = Date.parse(q.observedAt);
    return Number.isFinite(t) ? Math.max(0, nowMs - t) : Number.POSITIVE_INFINITY;
  });
  const finite = ages.filter((a) => Number.isFinite(a));
  if (!finite.length) return 25;
  const maxAge = Math.max(...finite);
  const spread = Math.max(...finite) - Math.min(...finite);
  let s = 100;
  if (maxAge > PRICE_TRADE_STALE_MS) s -= 40;
  else if (maxAge > DELAYED_MS) s -= 15;
  if (spread > 10 * 60_000) s -= 20;
  return clamp(s, 10, 100);
}

export function assessDataQuality(input: DataQualityInput): DataQualityAssessment {
  const nowMs = input.nowMs ?? Date.now();
  const quotes = input.quotes.filter((q) => q.priceUsd > 0 && Number.isFinite(q.priceUsd));
  const primaryOk = Number.isFinite(input.primaryPriceUsd) && input.primaryPriceUsd > 0;
  if (!primaryOk && quotes.length === 0) {
    return {
      assetId: input.assetId,
      symbol: input.symbol,
      score: 0,
      components: {
        sourceReliability: 0,
        freshness: 0,
        timestampAccuracy: 0,
        completeness: 0,
        sourceAgreement: 0,
        delayedDataPenalty: 0,
        stalePenalty: 0,
        fakeMovePenalty: 0,
        eventConfirmation: 50,
        newsConfirmation: 50,
      },
      flags: ["missing_price", "incomplete_fields"],
      sourceConflict: false,
      conflictingSources: [],
      conflictType: null,
      conflictSeverity: null,
      conflictDetails: null,
      delayed: true,
      stale: true,
      fakeMoveSuspected: false,
      washTradeSuspected: false,
      eventConfirmed: null,
      newsConfirmed: null,
      blockEntry: true,
      blockReason: "DATA UNAVAILABLE: missing price — not invented",
      learningWeight: 0,
      quoteCount: 0,
      spreadBps: null,
    };
  }
  const agreement = sourceAgreementScore(quotes, input.kind);
  const fresh = freshnessScore(input.dataAgeMs);
  const fake = detectFakeMove(input, agreement.score, quotes.length);
  const ev = eventConfirmation(input, nowMs);
  const nw = newsConfirmation(input, nowMs);
  const complete = completenessScore(input);
  const tsAcc = timestampAccuracy(quotes.length ? quotes : input.primaryObservedAt ? [{
    source: input.primarySource ?? "unknown",
    priceUsd: input.primaryPriceUsd,
    observedAt: input.primaryObservedAt,
  }] : [], nowMs);
  const rel = reliabilityOf(input.primarySource) * 100;
  const weightedRel = quotes.length
    ? mean(quotes.map((q) => (q.reliability ?? reliabilityOf(q.source)) * 100))
    : rel;

  const flags = [...fake.flags];
  if (fresh.delayed) flags.push("delayed_data");
  if (fresh.stale) flags.push("stale_data");
  if (agreement.conflict) flags.push("source_conflict");
  if (quotes.length < 2) flags.push("single_source");
  if (ev.confirmed === false) flags.push("event_unconfirmed_by_price");
  if (nw.confirmed === false) flags.push("news_unconfirmed_by_price");
  if (complete < 60) flags.push("incomplete_fields");

  const components: DataQualityComponents = {
    sourceReliability: clamp(weightedRel, 0, 100),
    freshness: clamp(fresh.score, 0, 100),
    timestampAccuracy: clamp(tsAcc, 0, 100),
    completeness: clamp(complete, 0, 100),
    sourceAgreement: clamp(agreement.score, 0, 100),
    delayedDataPenalty: clamp(fresh.delayedPenalty, 0, 100),
    stalePenalty: clamp(fresh.stalePenalty, 0, 100),
    fakeMovePenalty: clamp(fake.penalty, 0, 100),
    eventConfirmation: clamp(ev.score, 0, 100),
    newsConfirmation: clamp(nw.score, 0, 100),
  };

  let score =
    components.sourceReliability * 0.12 +
    components.freshness * 0.16 +
    components.timestampAccuracy * 0.08 +
    components.completeness * 0.08 +
    components.sourceAgreement * 0.18 +
    components.eventConfirmation * 0.08 +
    components.newsConfirmation * 0.06;
  score -= components.delayedDataPenalty * 0.35;
  score -= components.stalePenalty * 0.45;
  score -= components.fakeMovePenalty * 0.55;
  score = clamp(score, 0, 100);

  let blockReason: string | null = null;
  if (fresh.stale) blockReason = "Stale mark — paper entry blocked";
  else if (fake.fakeMove && score < 45) blockReason = "Suspected fake move / unconfirmed pump";
  else if (agreement.conflict?.conflictSeverity === "high") blockReason = "High-severity cross-source price conflict";
  else if (score < DATA_QUALITY_MIN_ENTRY) blockReason = `Data quality ${score.toFixed(0)} below entry floor ${DATA_QUALITY_MIN_ENTRY}`;

  const learningWeight = score < 25 ? 0 : clamp(score / 100, DATA_QUALITY_MIN_LEARNING_WEIGHT, 1);

  return {
    assetId: input.assetId,
    symbol: input.symbol,
    score,
    components,
    flags,
    sourceConflict: Boolean(agreement.conflict),
    conflictingSources: agreement.conflict?.conflictingSources ?? [],
    conflictType: agreement.conflict?.conflictType ?? null,
    conflictSeverity: agreement.conflict?.conflictSeverity ?? null,
    conflictDetails: agreement.conflict?.details ?? null,
    delayed: fresh.delayed,
    stale: fresh.stale,
    fakeMoveSuspected: fake.fakeMove,
    washTradeSuspected: fake.wash,
    eventConfirmed: ev.confirmed,
    newsConfirmed: nw.confirmed,
    blockEntry: blockReason != null,
    blockReason,
    learningWeight,
    quoteCount: quotes.length,
    spreadBps: agreement.spreadBps,
  };
}

export function qualitySummary(a: DataQualityAssessment): {
  score: number;
  sourceConflict: boolean;
  delayed: boolean;
  stale: boolean;
  fakeMoveSuspected: boolean;
  blockEntry: boolean;
  flags: string[];
} {
  return {
    score: a.score,
    sourceConflict: a.sourceConflict,
    delayed: a.delayed,
    stale: a.stale,
    fakeMoveSuspected: a.fakeMoveSuspected,
    blockEntry: a.blockEntry,
    flags: a.flags,
  };
}
