import { SOURCE_RELIABILITY } from "./config.ts";
import { clamp } from "./math.ts";
import { extractEntities } from "./sources.ts";
import { nowIso } from "./time.ts";
import type { AssetRow, FreshnessBand, NewsDTO, PolymarketDTO } from "./types.ts";

export type MonitoredEntity = {
  id: string;
  name: string;
  kind: string;
  aliases: string[];
  keywords: string[];
  credibility: number;
};

export type DetectedEvent = {
  id: string;
  source: string;
  sourceReliability: number;
  author: string | null;
  entityId: string | null;
  title: string;
  url: string | null;
  rawText: string;
  eventType: string;
  category: string;
  affectedAssets: string[];
  sentiment: number | null;
  novelty: number;
  credibility: number;
  marketRelevance: number;
  impactScore: number;
  confidence: number;
  historicalContext: string;
  supportingSources: string[];
  contradictorySources: string[];
  publishedAt: string | null;
  observedAt: string;
};

export type EventReaction = {
  horizonMinutes: number;
  startPrice: number | null;
  endPrice: number | null;
  returnPct: number | null;
  direction: "up" | "down" | "flat" | null;
};

const ENTITY_KEYWORDS = [
  { id: "trump", names: ["trump", "donald trump"], keywords: ["trump", "donald"], credibility: 0.7, kind: "person" },
  { id: "fed", names: ["fed", "federal reserve", "fomc"], keywords: ["fed", "federal reserve", "fomc", "interest rate", "rate decision"], credibility: 0.9, kind: "institution" },
  { id: "sec", names: ["sec"], keywords: ["sec", "securities", "etf", "approval"], credibility: 0.85, kind: "institution" },
  { id: "us_gov", names: ["white house", "us government", "biden administration"], keywords: ["white house", "executive order", "sanctions", "tariffs"], credibility: 0.75, kind: "institution" },
  { id: "etf", names: ["etf"], keywords: ["etf", "spot etf", "approval"], credibility: 0.8, kind: "event_type" },
  { id: "hack", names: ["hack", "exploit", "breach"], keywords: ["hack", "exploit", "breach"], credibility: 0.7, kind: "event_type" },
  { id: "regulation", names: ["regulation", "sanctions", "ban"], keywords: ["regulation", "sanctions", "ban"], credibility: 0.75, kind: "event_type" },
];

function normalizeText(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function detectEntities(title: string, summary?: string | null): { entityId: string | null; matched: string[]; credibility: number } {
  const text = normalizeText(`${title} ${summary ?? ""}`);
  let best: { entityId: string | null; matched: string[]; credibility: number } = { entityId: null, matched: [], credibility: 0.5 };
  for (const e of ENTITY_KEYWORDS) {
    const hits = [] as string[];
    for (const name of e.names) {
      if (text.includes(name)) hits.push(name);
    }
    for (const kw of e.keywords) {
      if (text.includes(kw) && !hits.includes(kw)) hits.push(kw);
    }
    if (hits.length && e.credibility > best.credibility) {
      best = { entityId: e.id, matched: hits, credibility: e.credibility };
    }
  }
  return best;
}

function newsToneScore(title: string): number {
  const t = title.toLowerCase();
  const bear = /\b(hack|exploit|rug|insolvent|halted|delist|lawsuit|sec charges|outage|breach|liquidation cascade|banned|sanctions|ban|crash|collapse|fraud)\b/;
  const bull = /\b(etf approved|spot etf|lists|listing|partnership|upgrade|mainnet|buyback|approved|adopt|bullish|breakthrough)\b/;
  if (bear.test(t)) return -0.6;
  if (bull.test(t)) return 0.5;
  return 0;
}

export function classifyEvent(title: string): { eventType: string; category: string } {
  const t = title.toLowerCase();
  if (/\b(hack|exploit|breach|drained)\b/.test(t)) return { eventType: "security_incident", category: "risk" };
  if (/\b(etf|approval|approved|sec)\b/.test(t)) return { eventType: "regulatory", category: "etf" };
  if (/\b(sanctions|ban|regulation|illegal|law)\b/.test(t)) return { eventType: "regulatory", category: "regulation" };
  if (/\b(fed|fomc|rate|interest rate)\b/.test(t)) return { eventType: "macro", category: "monetary_policy" };
  if (/\b(tariff|trade war|geopolitical|war|election)\b/.test(t)) return { eventType: "macro", category: "geopolitics" };
  return { eventType: "statement", category: "general" };
}

export function computeNovelty(title: string, existing: { title: string; publishedAt: string | null }[]): number {
  const normalized = normalizeText(title);
  if (!existing.length) return 1;
  let maxSim = 0;
  for (const e of existing) {
    const words = new Set(normalizeText(e.title).split(" ").filter((w) => w.length > 3));
    const mine = normalized.split(" ").filter((w) => w.length > 3);
    if (!mine.length || !words.size) continue;
    const overlap = mine.filter((w) => words.has(w)).length;
    const sim = overlap / Math.max(mine.length, words.size);
    if (sim > maxSim) maxSim = sim;
  }
  return clamp(1 - maxSim, 0, 1);
}

export function detectEvents(opts: {
  news: NewsDTO[];
  social: { platform: string; author: string | null; body: string }[];
  polymarket: PolymarketDTO[];
  existing?: DetectedEvent[];
  assets: AssetRow[];
}): DetectedEvent[] {
  const existing = opts.existing ?? [];
  const out: DetectedEvent[] = [];
  const symbols = opts.assets.map((a) => a.symbol.toUpperCase());
  for (const n of opts.news) {
    if (n.freshness === "STALE" || n.freshness === "UNKNOWN") continue;
    const detected = detectEntities(n.title, n.summary);
    if (!detected.entityId) continue;
    const classification = classifyEvent(n.title);
    const sentiment = newsToneScore(n.title);
    const novelty = computeNovelty(n.title, existing.map((e) => ({ title: e.title, publishedAt: e.publishedAt })));
    const relevance = cryptoRelevance(n.title, symbols);
    const credibility = 0.6 * n.sourceReliability + 0.4 * detected.credibility;
    const impact = clamp(0.3 * novelty + 0.3 * Math.abs(sentiment ?? 0) + 0.2 * relevance.score + 0.2 * credibility, 0, 1);
    const confidence = clamp(impact * credibility * (n.freshness === "NEW" ? 1 : 0.7), 0, 1);
    out.push({
      id: `news:${n.id}`,
      source: n.source,
      sourceReliability: n.sourceReliability,
      author: n.source,
      entityId: detected.entityId,
      title: n.title,
      url: n.url,
      rawText: `${n.title}\n${n.summary ?? ""}`,
      eventType: classification.eventType,
      category: classification.category,
      affectedAssets: relevance.assets,
      sentiment,
      novelty,
      credibility,
      marketRelevance: relevance.score,
      impactScore: impact,
      confidence,
      historicalContext: "No historical reaction data yet",
      supportingSources: [n.source],
      contradictorySources: [],
      publishedAt: n.publishedAt,
      observedAt: nowIso(),
    });
  }

  // Polymarket probability jumps as event confirmation signal.
  for (const pm of opts.polymarket.filter((m) => m.probabilityChange24h != null && Math.abs(m.probabilityChange24h) >= 0.06)) {
    const classification = classifyEvent(pm.question);
    const entity = detectEntities(pm.question);
    if (!entity.entityId) continue;
    const sentiment = (pm.probabilityChange24h ?? 0) > 0 ? 0.4 : -0.4;
    const relevance = cryptoRelevance(pm.question, symbols);
    const credibility = 0.6 * SOURCE_RELIABILITY.polymarket + 0.4 * entity.credibility;
    const impact = clamp(0.25 * Math.abs(pm.probabilityChange24h ?? 0) + 0.25 * Math.abs(sentiment) + 0.25 * relevance.score + 0.25 * credibility, 0, 1);
    out.push({
      id: `pm:${pm.id}`,
      source: "polymarket",
      sourceReliability: SOURCE_RELIABILITY.polymarket,
      author: null,
      entityId: entity.entityId,
      title: pm.question,
      url: pm.url,
      rawText: pm.question,
      eventType: classification.eventType,
      category: classification.category,
      affectedAssets: relevance.assets,
      sentiment,
      novelty: 0.7,
      credibility,
      marketRelevance: relevance.score,
      impactScore: impact,
      confidence: clamp(impact * credibility, 0, 1),
      historicalContext: "Prediction-market probability shift — not a price reaction",
      supportingSources: ["polymarket"],
      contradictorySources: [],
      publishedAt: null,
      observedAt: nowIso(),
    });
  }

  return out.sort((a, b) => b.confidence - a.confidence);
}

function cryptoRelevance(text: string, symbols: string[]): { score: number; assets: string[] } {
  const assets = extractEntities(text, symbols);
  const t = text.toLowerCase();
  const cryptoTerms = /\b(bitcoin|btc|ethereum|eth|solana|sol|crypto|blockchain|defi|altcoin|altcoins|token|stablecoin|stablecoins)\b/;
  const score = clamp((assets.length ? 0.4 : 0) + (cryptoTerms.test(t) ? 0.35 : 0) + (t.includes("$") ? 0.05 : 0), 0, 1);
  return { score, assets };
}

export function informationAdvantageScore(opts: {
  eventImpact: number;
  eventConfidence: number;
  walletQualityScore: number;
  walletConsensus: number;
  timingSeconds: number;
  freshness: FreshnessBand;
  historicalPredictiveValue: number;
}): { total: number; components: Record<string, number> } {
  const { eventImpact, eventConfidence, walletQualityScore, walletConsensus, timingSeconds, freshness, historicalPredictiveValue } = opts;
  const decay = Math.exp(-Math.max(0, timingSeconds - 60) / 3600);
  const freshScore = freshness === "NEW" ? 1 : freshness === "RECENT" ? 0.6 : freshness === "STALE" ? 0.2 : 0.1;
  const components = {
    eventSignificance: eventImpact * eventConfidence,
    walletQuality: walletQualityScore,
    walletConsensus: walletConsensus,
    timing: decay,
    freshness: freshScore,
    historicalValue: historicalPredictiveValue,
  };
  const total = clamp(
    0.25 * components.eventSignificance +
      0.2 * components.walletQuality +
      0.15 * components.walletConsensus +
      0.15 * components.timing +
      0.1 * components.freshness +
      0.15 * components.historicalValue,
    0,
    1,
  );
  return { total, components };
}

export async function fetchHistoricalReactions(
  event: DetectedEvent,
  assetPrices: Map<string, { t: number; price: number }[]>,
): Promise<EventReaction[]> {
  const horizons = [1, 5, 15, 60, 240, 1440];
  const out: EventReaction[] = [];
  const eventTime = event.publishedAt ? Date.parse(event.publishedAt) : Date.now();
  if (!Number.isFinite(eventTime)) return out;
  for (const assetId of event.affectedAssets.slice(0, 3)) {
    const series = assetPrices.get(assetId);
    if (!series || series.length < 2) continue;
    const start = series.find((p) => p.t >= eventTime) ?? series[0];
    if (!start) continue;
    for (const mins of horizons) {
      const target = eventTime + mins * 60_000;
      const end = series.find((p) => p.t >= target) ?? series[series.length - 1];
      if (!end) continue;
      const ret = start.price > 0 ? ((end.price - start.price) / start.price) * 100 : null;
      out.push({
        horizonMinutes: mins,
        startPrice: start.price,
        endPrice: end.price,
        returnPct: ret,
        direction: ret == null ? null : ret > 0.5 ? "up" : ret < -0.5 ? "down" : "flat",
      });
    }
  }
  return out;
}
