/**
 * Pure, deterministic X/Twitter market-moving intelligence pipeline.
 *
 * This module contains no DB imports and no network I/O, so it can be tested
 * directly with Node's built-in test runner.
 */

import { createHash } from "node:crypto";
import type { XMarketAccount, XAccountTier } from "../../../config/x-market-watchlist.ts";

export type SymbolName = {
  symbol: string;
  name: string;
};

export type XPost = {
  id: string;
  postId: string;
  username: string;
  displayName: string;
  body: string;
  url: string | null;
  publishedAt: string | null;
  engagement: number | null;
};

export type EventCategory =
  | "EARNINGS"
  | "GUIDANCE"
  | "PRODUCT"
  | "ACQUISITION"
  | "MERGER"
  | "INVESTMENT"
  | "REGULATION"
  | "TARIFF"
  | "SANCTIONS"
  | "POLICY"
  | "INTEREST_RATES"
  | "FED"
  | "SEC"
  | "LEGAL"
  | "LAWSUIT"
  | "APPROVAL"
  | "REJECTION"
  | "ETF"
  | "CRYPTO_REGULATION"
  | "CRYPTO_PROJECT"
  | "EXCHANGE"
  | "SECURITY"
  | "HACK"
  | "PARTNERSHIP"
  | "CEO_CHANGE"
  | "SUPPLY"
  | "DEMAND"
  | "MACRO"
  | "GEOPOLITICAL"
  | "OTHER";

export type AffectedEntityExtraction = {
  assets: string[];
  sectors: string[];
  companies: string[];
  confidence: number;
  directMention: boolean;
  inferredExposure: boolean;
  reason: string;
};

export type XMarketEvent = {
  id: string;
  source: "x";
  author: string;
  username: string;
  tier: XAccountTier;
  title: string;
  body: string;
  url: string | null;
  eventType: EventCategory;
  category: string;
  affectedAssets: string[];
  affectedSectors: string[];
  affectedCompanies: string[];
  sentiment: number | null;
  novelty: number;
  credibility: number;
  marketRelevance: number;
  impactScore: number; // 0–1 internal
  marketImpactScore: number; // 0–100 user-facing
  confidence: number;
  signal: "EARLY_PAPER_SIGNAL" | "LATE_EVENT" | "WAIT" | "REJECT";
  signalReason: string;
  marketReaction: "already_priced" | "early_information" | "uncertain" | "contradicted" | "no_data";
  confirmationCount: number;
  contradictionCount: number;
  eventStatus: "preliminary" | "confirmed" | "contradicted" | "stale";
  publishedAt: string | null;
  receivedAt: string;
  classifiedAt: string;
  marketDataCheckedAt: string;
  signalGeneratedAt: string;
  latency: XLatencyMetrics;
};

export type XLatencyMetrics = {
  detectionLatencyMs: number;
  classificationLatencyMs: number;
  marketCheckLatencyMs: number;
  signalLatencyMs: number;
  totalLatencyMs: number;
  postCreatedAt: string | null;
  xReceivedAt: string;
  classifiedAt: string;
  marketDataCheckedAt: string;
  signalGeneratedAt: string;
};

export type MarketSnapshot = {
  symbol: string;
  priceUsd: number;
  change24hPct: number | null;
  volume24hUsd: number | null;
};

export type MarketReaction = {
  preEventPrice: number | null;
  postEventPrice: number | null;
  eventReturnPct: number | null;
  abnormalReturnPct: number | null;
  volumeChangePct: number | null;
  marketReacted: boolean;
  reactionStrength: "none" | "small" | "moderate" | "large";
};

const TIER_WEIGHT: Record<XAccountTier, number> = {
  TIER_1: 1.0,
  TIER_2: 0.7,
  TIER_3: 0.55,
};

const CATEGORY_KEYWORDS: Array<{ category: EventCategory; keywords: string[]; severity: number }> = [
  { category: "TARIFF", keywords: ["tariff", "tariffs"], severity: 0.85 },
  { category: "SANCTIONS", keywords: ["sanction", "sanctions"], severity: 0.85 },
  { category: "POLICY", keywords: ["policy", "executive order", "legislation", "bill"], severity: 0.7 },
  { category: "REGULATION", keywords: ["regulation", "regulate", "rules"], severity: 0.75 },
  { category: "FED", keywords: ["fed", "federal reserve", "fomc"], severity: 0.9 },
  { category: "INTEREST_RATES", keywords: ["interest rate", "rates", "rate cut", "rate hike"], severity: 0.85 },
  { category: "SEC", keywords: ["sec", "securities"], severity: 0.8 },
  { category: "ETF", keywords: ["etf", "spot etf", "exchange traded fund"], severity: 0.75 },
  { category: "APPROVAL", keywords: ["approved", "approval", "cleared"], severity: 0.7 },
  { category: "REJECTION", keywords: ["rejected", "rejection", "denied"], severity: 0.7 },
  { category: "EARNINGS", keywords: ["earnings", "earned", "revenue", "quarterly"], severity: 0.8 },
  { category: "GUIDANCE", keywords: ["guidance", "forecast", "outlook"], severity: 0.75 },
  { category: "PRODUCT", keywords: ["product", "launch", "released", "shipped"], severity: 0.65 },
  { category: "ACQUISITION", keywords: ["acquisition", "acquire", "acquired", "buying"], severity: 0.85 },
  { category: "MERGER", keywords: ["merger", "merging", "merged"], severity: 0.85 },
  { category: "INVESTMENT", keywords: ["investment", "invest", "investing", "stake"], severity: 0.7 },
  { category: "PARTNERSHIP", keywords: ["partnership", "partner", "collaboration", "alliance"], severity: 0.65 },
  { category: "CEO_CHANGE", keywords: ["ceo", "chief executive", "stepping down", "resigned", "appointed"], severity: 0.7 },
  { category: "HACK", keywords: ["hack", "hacked", "breach", "exploit", "drained"], severity: 0.8 },
  { category: "SECURITY", keywords: ["security", "vulnerability", "bug"], severity: 0.6 },
  { category: "LEGAL", keywords: ["lawsuit", "sued", "litigation", "court", "subpoena"], severity: 0.75 },
  { category: "LAWSUIT", keywords: ["lawsuit", "sued", "litigation"], severity: 0.75 },
  { category: "CRYPTO_REGULATION", keywords: ["crypto regulation", "stablecoin", "token"], severity: 0.75 },
  { category: "CRYPTO_PROJECT", keywords: ["mainnet", "upgrade", "testnet", "airdrop"], severity: 0.6 },
  { category: "EXCHANGE", keywords: ["exchange", "listing", "delist"], severity: 0.65 },
  { category: "MACRO", keywords: ["inflation", "recession", "gdp", "unemployment", "jobs report"], severity: 0.75 },
  { category: "GEOPOLITICAL", keywords: ["war", "conflict", "election", "geopolitical"], severity: 0.8 },
  { category: "SUPPLY", keywords: ["supply", "shortage", "production"], severity: 0.6 },
  { category: "DEMAND", keywords: ["demand", "orders", "backlog"], severity: 0.6 },
];

const ASSET_KEYWORDS: Record<string, string[]> = {
  BTC: ["bitcoin", "btc"],
  ETH: ["ethereum", "eth"],
  SOL: ["solana", "sol"],
  BNB: ["binance", "bnb"],
  DOGE: ["dogecoin", "doge"],
  XRP: ["xrp", "ripple"],
  ADA: ["cardano", "ada"],
  AVAX: ["avalanche", "avax"],
  LINK: ["chainlink", "link"],
  MATIC: ["polygon", "matic"],
  USDC: ["usdc"],
  USDT: ["tether", "usdt"],
  COIN: ["coinbase"],
  NVDA: ["nvidia"],
  AMD: ["amd"],
  INTC: ["intel"],
  DELL: ["dell"],
  TSLA: ["tesla"],
  AAPL: ["apple"],
  MSFT: ["microsoft"],
  AMZN: ["amazon"],
  GOOGL: ["google", "alphabet"],
  META: ["meta"],
  JPM: ["jpmorgan"],
  GS: ["goldman"],
  BAC: ["bank of america"],
  PYPL: ["paypal"],
  SQ: ["block", "square"],
  SPY: ["sp500", "s&p 500"],
  QQQ: ["nasdaq"],
  XLF: ["financials"],
  GLD: ["gold"],
  USD: ["dollar", "usd"],
};

const SECTOR_KEYWORDS: Record<string, string[]> = {
  semiconductors: ["semiconductor", "chip", "chips", "ai chip", "gpu"],
  technology: ["technology", "tech", "software", "cloud"],
  financials: ["bank", "banks", "financial", "lending"],
  crypto: ["crypto", "cryptocurrency", "bitcoin", "blockchain"],
  energy: ["oil", "gas", "energy"],
  macro: ["economy", "economic", "recession", "inflation"],
};

const SECTOR_ASSETS: Record<string, string[]> = {
  semiconductors: ["NVDA", "AMD", "INTC", "TSM", "AVGO", "QCOM", "MRVL"],
  technology: ["AAPL", "MSFT", "GOOGL", "META", "AMZN", "TSLA", "NFLX"],
  financials: ["JPM", "GS", "BAC", "MS", "WFC", "XLF"],
  crypto: ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP", "ADA"],
  energy: ["XLE", "CVX", "XOM"],
  macro: ["SPY", "QQQ", "GLD", "USD"],
};

const NOISE_PATTERNS = [
  /\b(happy birthday|good morning|good night|great meeting|thank you for|check out this article)\b/i,
  /^\s*$/,
];

function normalizeText(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function isNoise(text: string): boolean {
  return NOISE_PATTERNS.some((p) => p.test(text));
}

export function eventFingerprint(text: string): string {
  const normalized = normalizeText(text).split(" ").filter((w) => w.length > 3).sort().join(" ");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

export function classifyXEvent(text: string): { eventType: EventCategory; category: string; severity: number } {
  const t = normalizeText(text);
  let best: { eventType: EventCategory; category: string; severity: number } = {
    eventType: "OTHER",
    category: "general",
    severity: 0.35,
  };
  for (const rule of CATEGORY_KEYWORDS) {
    if (rule.keywords.some((kw) => t.includes(kw))) {
      if (rule.severity > best.severity) {
        best = { eventType: rule.category, category: rule.category.toLowerCase(), severity: rule.severity };
      }
    }
  }
  return best;
}

export function extractAffectedEntities(
  text: string,
  account: XMarketAccount,
  assets: SymbolName[],
): AffectedEntityExtraction {
  const t = normalizeText(text);
  const foundAssets = new Set<string>();
  const directAssets = new Set<string>();
  const foundSectors = new Set<string>();
  const foundCompanies = new Set<string>();

  // Direct keyword matches.
  for (const [symbol, kws] of Object.entries(ASSET_KEYWORDS)) {
    if (kws.some((kw) => t.includes(kw))) {
      foundAssets.add(symbol);
      directAssets.add(symbol);
    }
  }

  // Crypto symbols from the live asset list.
  for (const asset of assets) {
    const sym = asset.symbol.toUpperCase();
    const name = asset.name.toLowerCase();
    if (t.includes(sym.toLowerCase()) || (name.length > 2 && t.includes(name))) {
      foundAssets.add(sym);
      directAssets.add(sym);
    }
  }

  // Account-specific interests (indirect exposure).
  for (const interest of account.assetsOfInterest) {
    const up = interest.toUpperCase();
    const kws = ASSET_KEYWORDS[up] ?? [interest.toLowerCase()];
    if (kws.some((kw) => t.includes(kw)) && !foundAssets.has(up)) {
      foundAssets.add(up);
    }
  }

  // Sector inference.
  for (const [sector, kws] of Object.entries(SECTOR_KEYWORDS)) {
    if (kws.some((kw) => t.includes(kw))) {
      foundSectors.add(sector);
      for (const sym of SECTOR_ASSETS[sector] ?? []) {
        if (!foundAssets.has(sym)) foundAssets.add(sym);
      }
    }
  }

  // Company inference from major account names.
  for (const [symbol, kws] of Object.entries(ASSET_KEYWORDS)) {
    if (kws.some((kw) => t.includes(kw)) && symbol.length <= 5) {
      foundCompanies.add(symbol);
    }
  }

  const directMention = directAssets.size > 0;
  const inferredExposure = !directMention && foundAssets.size > 0;
  const confidence = directMention ? 0.9 : inferredExposure ? 0.6 : 0.2;
  const reason = directMention
    ? `Direct mention of ${[...foundAssets].join(", ")}`
    : inferredExposure
      ? `Inferred exposure via sector/watchlist: ${[...foundAssets].slice(0, 8).join(", ")}`
      : "No identifiable affected assets";

  return {
    assets: [...foundAssets],
    sectors: [...foundSectors],
    companies: [...foundCompanies],
    confidence,
    directMention,
    inferredExposure,
    reason,
  };
}

export function computeNovelty(text: string, existingFingerprints: string[]): number {
  const fp = eventFingerprint(text);
  if (!existingFingerprints.length) return 1;
  let maxSim = 0;
  for (const other of existingFingerprints) {
    const a = new Set(fp.split(""));
    const b = new Set(other.split(""));
    const intersection = new Set([...a].filter((x) => b.has(x)));
    const sim = intersection.size / Math.max(a.size, b.size);
    if (sim > maxSim) maxSim = sim;
  }
  return Math.max(0, 1 - maxSim);
}

export function sentimentScore(text: string): number {
  const t = text.toLowerCase();
  const bear = /\b(ban|sanction|tariff|lawsuit|hack|exploit|breach|recession|crash|collapse|fraud|reject|deny|cut|fire|resign|delay|cancel|concern)\b/;
  const bull = /\b(approve|approval|partnership|launch|invest|growth|breakthrough|record|strong|upgrade|adopt|support|boost|buy)\b/;
  if (bear.test(t)) return -0.5;
  if (bull.test(t)) return 0.4;
  return 0;
}

export function computeImpactScore(
  account: XMarketAccount,
  extraction: AffectedEntityExtraction,
  classification: { severity: number },
  novelty: number,
): number {
  const tierWeight = TIER_WEIGHT[account.tier];
  const specificity = extraction.directMention ? 1 : extraction.inferredExposure ? 0.6 : 0.25;
  const assetRelevance = Math.min(
    1,
    0.35 + extraction.assets.length * 0.22 + (extraction.sectors.length ? 0.12 : 0),
  );
  const raw =
    tierWeight *
    account.influenceScore *
    classification.severity *
    assetRelevance *
    novelty *
    specificity;
  return Math.min(1, Math.max(0, raw));
}

export function marketImpactScore(impact: number): number {
  return Math.round(impact * 100);
}

export function classifyMarketReaction(reaction: MarketReaction): XMarketEvent["marketReaction"] {
  if (reaction.preEventPrice == null || reaction.postEventPrice == null) return "no_data";
  const absReturn = Math.abs(reaction.eventReturnPct ?? 0);
  if (reaction.marketReacted) return "already_priced";
  if (absReturn > 2) return "early_information";
  return "uncertain";
}

export function computeMarketReaction(
  affectedAssets: string[],
  snapshots: MarketSnapshot[],
  _windowMinutes = 5,
): MarketReaction {
  // We only have a single point-in-time snapshot. A full implementation would
  // re-check prices after `windowMinutes`. For the initial pipeline we record
  // the immediate snapshot and estimate reaction from the already-observed
  // 24h change as a crude abnormal-return proxy.
  const asset = affectedAssets[0];
  const snap = asset ? snapshots.find((s) => s.symbol.toUpperCase() === asset.toUpperCase()) : undefined;
  if (!snap || !snap.priceUsd) {
    return {
      preEventPrice: null,
      postEventPrice: null,
      eventReturnPct: null,
      abnormalReturnPct: null,
      volumeChangePct: null,
      marketReacted: false,
      reactionStrength: "none",
    };
  }
  const change24h = snap.change24hPct ?? 0;
  const abnormal = change24h; // crude proxy
  const strength: MarketReaction["reactionStrength"] =
    Math.abs(abnormal) > 8 ? "large" : Math.abs(abnormal) > 3 ? "moderate" : Math.abs(abnormal) > 0.8 ? "small" : "none";
  return {
    preEventPrice: snap.priceUsd,
    postEventPrice: snap.priceUsd,
    eventReturnPct: 0,
    abnormalReturnPct: abnormal,
    volumeChangePct: null,
    marketReacted: strength !== "none",
    reactionStrength: strength,
  };
}

export function generateSignal(
  impact: number,
  marketImpact: number,
  reaction: MarketReaction,
): { signal: XMarketEvent["signal"]; reason: string } {
  if (impact < 0.35) {
    return { signal: "REJECT", reason: "Impact below actionable threshold" };
  }
  if (marketImpact >= 70 && !reaction.marketReacted) {
    return {
      signal: "EARLY_PAPER_SIGNAL",
      reason: "High-impact event with no material market reaction yet",
    };
  }
  if (marketImpact >= 60 && reaction.marketReacted) {
    return { signal: "LATE_EVENT", reason: "High-impact event but market appears to have moved" };
  }
  if (marketImpact >= 45) {
    return { signal: "WAIT", reason: "Moderate impact; waiting for confirmation or clearer reaction" };
  }
  return { signal: "REJECT", reason: "Low confidence or weak market relevance" };
}

export function eventStatus(
  confirmationCount: number,
  contradictionCount: number,
  isStale: boolean,
): XMarketEvent["eventStatus"] {
  if (isStale) return "stale";
  if (contradictionCount > confirmationCount) return "contradicted";
  if (confirmationCount >= 1) return "confirmed";
  return "preliminary";
}

export function buildXMarketEvent(
  post: XPost,
  account: XMarketAccount,
  assets: SymbolName[],
  snapshots: MarketSnapshot[],
  existingFingerprints: string[],
  confirmationCount: number,
  contradictionCount: number,
  receivedAt: string,
): XMarketEvent {
  const classifiedAt = new Date().toISOString();
  const classification = classifyXEvent(post.body);
  const extraction = extractAffectedEntities(post.body, account, assets);
  const sentiment = sentimentScore(post.body);
  const novelty = computeNovelty(post.body, existingFingerprints);
  const impact = computeImpactScore(account, extraction, classification, novelty);
  const marketImpact = marketImpactScore(impact);
  const marketDataCheckedAt = new Date().toISOString();
  const reaction = computeMarketReaction(extraction.assets, snapshots);
  const signalResult = generateSignal(impact, marketImpact, reaction);
  const signalGeneratedAt = new Date().toISOString();
  const status = eventStatus(confirmationCount, contradictionCount, false);

  const latency: XLatencyMetrics = {
    postCreatedAt: post.publishedAt,
    xReceivedAt: receivedAt,
    classifiedAt,
    marketDataCheckedAt,
    signalGeneratedAt,
    detectionLatencyMs: Math.max(0, new Date(receivedAt).getTime() - new Date(post.publishedAt ?? receivedAt).getTime()),
    classificationLatencyMs: Math.max(0, new Date(classifiedAt).getTime() - new Date(receivedAt).getTime()),
    marketCheckLatencyMs: Math.max(0, new Date(marketDataCheckedAt).getTime() - new Date(classifiedAt).getTime()),
    signalLatencyMs: Math.max(0, new Date(signalGeneratedAt).getTime() - new Date(marketDataCheckedAt).getTime()),
    totalLatencyMs: Math.max(0, new Date(signalGeneratedAt).getTime() - new Date(post.publishedAt ?? receivedAt).getTime()),
  };

  return {
    id: `x:${post.id}`,
    source: "x",
    author: post.displayName,
    username: post.username,
    tier: account.tier,
    title: post.body.slice(0, 240),
    body: post.body,
    url: post.url,
    eventType: classification.eventType,
    category: classification.category,
    affectedAssets: extraction.assets,
    affectedSectors: extraction.sectors,
    affectedCompanies: extraction.companies,
    sentiment,
    novelty,
    credibility: extraction.confidence,
    marketRelevance: extraction.assets.length ? Math.min(1, extraction.assets.length * 0.2 + 0.3) : 0.1,
    impactScore: impact,
    marketImpactScore: marketImpact,
    confidence: impact * extraction.confidence,
    signal: signalResult.signal,
    signalReason: signalResult.reason,
    marketReaction: classifyMarketReaction(reaction),
    confirmationCount,
    contradictionCount,
    eventStatus: status,
    publishedAt: post.publishedAt,
    receivedAt,
    classifiedAt,
    marketDataCheckedAt,
    signalGeneratedAt,
    latency,
  };
}
