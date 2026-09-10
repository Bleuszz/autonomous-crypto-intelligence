/**
 * X/Twitter market-moving intelligence integration.
 *
 * - Uses the existing X_BEARER_TOKEN credential.
 * - Can be enabled with X_ENABLED=true and X_MODE=filtered_stream.
 * - Streams from X's filtered stream API when run in a long-lived process.
 * - Falls back safely to "X SOURCE UNAVAILABLE" on auth/connection errors.
 * - Never manufactures posts.
 */

import { getSql, type Sql } from "../db.ts";
import { fetchCoinGeckoMarkets, type NormalizedAsset } from "./sources.ts";
import { xBearer, loadRuntimeSecrets } from "./secrets.ts";
import { nowIso } from "./time.ts";
import { num0 } from "./math.ts";
import {
  enabledWatchlist,
  watchlistSummary,
  type XAccountTier,
  type XMarketAccount,
} from "../../../config/x-market-watchlist.ts";
import {
  buildXMarketEvent,
  eventFingerprint,
  isNoise,
  type MarketSnapshot,
  type XMarketEvent,
} from "./x-market-pipeline.ts";
import {
  normalizeStreamTweet,
  refreshStreamRules,
  xMarketEnabled,
  xMarketMode,
  xMarketStorageImpactThreshold,
  xMinImpactScore,
  xStreamLines,
} from "./x-market-stream.ts";

export type XStreamHealth = {
  connected: boolean;
  lastEventAt: string | null;
  reconnectCount: number;
  lastError: string | null;
  rateLimitState: string | null;
};

export type XAccountPerformance = {
  username: string;
  tier: XAccountTier;
  postsAnalysed: number;
  marketMovingPosts: number;
  precision: number | null;
  avgImpact: number | null;
  avgLeadTimeMs: number | null;
};

export type XLatencyPercentiles = {
  p50: number | null;
  p95: number | null;
  p99: number | null;
  avg: number | null;
  max: number | null;
  count: number;
};

export type XIntelligenceDashboard = {
  enabled: boolean;
  mode: string;
  health: XStreamHealth;
  watchlistSummary: { total: number; enabled: number; tier1: number; tier2: number; tier3: number };
  recentPosts: XMarketEvent[];
  breakingEvents: XMarketEvent[];
  accountPerformance: XAccountPerformance[];
  latency: {
    detection: XLatencyPercentiles;
    classification: XLatencyPercentiles;
    marketCheck: XLatencyPercentiles;
    signal: XLatencyPercentiles;
    total: XLatencyPercentiles;
  };
};

export async function startXMarketStream(): Promise<void> {
  if (typeof window !== "undefined") return;
  if (!xMarketEnabled() || xMarketMode() !== "filtered_stream") return;
  await loadRuntimeSecrets();
  const bearer = xBearer();
  if (!bearer) {
    await setXStreamHealth({ connected: false, lastError: "X_BEARER_TOKEN unset" });
    return;
  }

  const g = globalThis as typeof globalThis & { __xMarketStreamAbort?: AbortController };
  g.__xMarketStreamAbort?.abort();
  const ac = new AbortController();
  g.__xMarketStreamAbort = ac;

  // One attempt at rule setup; if it fails, record health and stop.
  const rules = await refreshStreamRules(bearer);
  if (!rules.ok) {
    await setXStreamHealth({ connected: false, lastError: rules.error });
    return;
  }

  let reconnectCount = 0;
  const maxReconnects = 20;
  const baseDelayMs = 5_000;

  while (!ac.signal.aborted && reconnectCount < maxReconnects) {
    try {
      await setXStreamHealth({ connected: true, reconnectCount, lastError: null });
      for await (const line of xStreamLines(bearer, ac.signal)) {
        if (ac.signal.aborted) break;
        const data = line as Record<string, unknown>;
        if (data.data) {
          // Attach expanded users to the tweet object for normalizer.
          const includes = (data.includes as Record<string, unknown>) ?? {};
          (data.data as Record<string, unknown>).users = includes.users ?? [];
          await handleStreamTweet(data.data);
        }
      }
    } catch (err) {
      reconnectCount++;
      const message = err instanceof Error ? err.message : String(err);
      await setXStreamHealth({ connected: false, reconnectCount, lastError: message });
      if (reconnectCount >= maxReconnects) break;
      const delay = Math.min(60_000, baseDelayMs * 2 ** Math.min(reconnectCount, 6));
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  await setXStreamHealth({ connected: false, lastError: reconnectCount >= maxReconnects ? "max reconnects reached" : "stopped" });
}

async function setXStreamHealth(partial: Partial<XStreamHealth>): Promise<void> {
  try {
    const sql = await getSql();
    const current = await sql.query<XStreamHealth>(
      "select connected, last_event_at, reconnect_count, last_error, rate_limit_state from x_stream_health where id = 'main'",
    );
    const existing = current[0];
    const next: XStreamHealth = {
      connected: partial.connected ?? existing?.connected ?? false,
      lastEventAt: partial.lastEventAt ?? existing?.lastEventAt ?? null,
      reconnectCount: partial.reconnectCount ?? existing?.reconnectCount ?? 0,
      lastError: partial.lastError ?? existing?.lastError ?? null,
      rateLimitState: partial.rateLimitState ?? existing?.rateLimitState ?? null,
    };
    await sql.query(
      `insert into x_stream_health (id, connected, last_event_at, reconnect_count, last_error, rate_limit_state, updated_at)
       values ('main', $1, $2, $3, $4, $5, now())
       on conflict (id) do update set
         connected = excluded.connected,
         last_event_at = excluded.last_event_at,
         reconnect_count = excluded.reconnect_count,
         last_error = excluded.last_error,
         rate_limit_state = excluded.rate_limit_state,
         updated_at = now()`,
      [next.connected, next.lastEventAt, next.reconnectCount, next.lastError, next.rateLimitState],
    );
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[x-market] health update failed:", e instanceof Error ? e.message : e);
    }
  }
}

async function handleStreamTweet(raw: unknown): Promise<void> {
  const post = normalizeStreamTweet(raw);
  if (!post) return;
  const watchlist = enabledWatchlist();
  const account = watchlist.find((a) => a.username.toLowerCase() === post.username.toLowerCase());
  if (!account) return; // not on watchlist
  if (isNoise(post.body)) return;

  try {
    const sql = await getSql();
    const { assets } = await fetchCoinGeckoMarkets(250);
    const recentHashes = await recentPostHashes(sql, account.username, 60);
    const fingerprint = eventFingerprint(post.body);
    if (recentHashes.has(fingerprint)) return; // dedupe

    const marketSnapshots = assets.map(toMarketSnapshot);
    const { confirmationCount, contradictionCount } = await countCrossSources(sql, post.body, account.assetsOfInterest);
    const event = buildXMarketEvent(
      post,
      account,
      assets,
      marketSnapshots,
      [...recentHashes],
      confirmationCount,
      contradictionCount,
      nowIso(),
    );

    await recordXPost(sql, event);
    await upsertXAccountStats(sql, account, event);
    await setXStreamHealth({ connected: true, lastEventAt: event.receivedAt });

    if (event.marketImpactScore >= xMarketStorageImpactThreshold()) {
      await recordDetectedXEvent(sql, event);
    }
    if (event.marketImpactScore >= xMinImpactScore()) {
      await recordXLearningEvent(sql, event);
    }
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[x-market] handle tweet failed:", e instanceof Error ? e.message : e);
    }
  }
}

function toMarketSnapshot(a: NormalizedAsset): MarketSnapshot {
  return {
    symbol: a.symbol,
    priceUsd: a.priceUsd ?? 0,
    change24hPct: a.change24hPct,
    volume24hUsd: a.volume24hUsd,
  };
}

async function recentPostHashes(sql: Sql, username: string, minutes: number): Promise<Set<string>> {
  const rows = await sql.query<{ body_hash: string }>(
    `select body_hash from x_stream_posts
     where username = $1 and created_at > now() - interval '${minutes} minutes'`,
    [username],
  );
  return new Set(rows.map((r) => r.body_hash));
}

async function countCrossSources(sql: Sql, body: string, interests: string[]): Promise<{ confirmationCount: number; contradictionCount: number }> {
  try {
    const keywords = interests.filter((kw) => kw.length > 2);
    const likeClauses = keywords.map((kw) => `%${kw.toLowerCase()}%`);
    if (!likeClauses.length) return { confirmationCount: 0, contradictionCount: 0 };
    const rows = await sql.query<{ count: number; contradiction: number }>(
      `select
         count(*) as count,
         count(*) filter (where sentiment < -0.3) as contradiction
       from detected_events
       where created_at > now() - interval '30 minutes'
         and (${likeClauses.map(() => "lower(title) like lower($1)").join(" or ")})`,
      likeClauses,
    );
    const r = rows[0];
    return {
      confirmationCount: num0(r?.count),
      contradictionCount: num0(r?.contradiction),
    };
  } catch {
    return { confirmationCount: 0, contradictionCount: 0 };
  }
}

async function recordXPost(sql: Sql, event: XMarketEvent): Promise<void> {
  await sql.query(
    `insert into x_stream_posts (
       id, post_id, username, tier, body, body_hash, event_type, category,
       affected_assets, affected_sectors, impact_score, confidence, signal, market_reaction,
       confirmation_count, contradiction_count, latency, published_at, received_at, classified_at, created_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20,now())
     on conflict (id) do nothing`,
    [
      event.id,
      event.id.replace("x:", ""),
      event.username,
      event.tier,
      event.body,
      eventFingerprint(event.body),
      event.eventType,
      event.category,
      JSON.stringify(event.affectedAssets),
      JSON.stringify(event.affectedSectors),
      event.marketImpactScore,
      event.confidence,
      event.signal,
      event.marketReaction,
      event.confirmationCount,
      event.contradictionCount,
      JSON.stringify(event.latency),
      event.publishedAt,
      event.receivedAt,
      event.classifiedAt,
    ],
  );
}

async function upsertXAccountStats(sql: Sql, account: XMarketAccount, event: XMarketEvent): Promise<void> {
  await sql.query(
    `insert into x_account_stats (username, tier, posts_analysed, market_moving_posts, total_impact, last_post_at, updated_at)
     values ($1,$2,1,case when $3 >= 60 then 1 else 0 end,$4,$5,now())
     on conflict (username) do update set
       posts_analysed = x_account_stats.posts_analysed + 1,
       market_moving_posts = x_account_stats.market_moving_posts + case when $3 >= 60 then 1 else 0 end,
       total_impact = x_account_stats.total_impact + $4,
       last_post_at = excluded.last_post_at,
       updated_at = now()`,
    [account.username, account.tier, event.marketImpactScore, event.marketImpactScore, event.receivedAt],
  );
}

async function recordDetectedXEvent(sql: Sql, event: XMarketEvent): Promise<void> {
  await sql.query(
    `insert into detected_events (
       id, source, source_reliability, author, entity_id, title, url, raw_text,
       event_type, category, affected_assets, sentiment, novelty, credibility,
       market_relevance, impact_score, confidence, historical_context,
       supporting_sources, contradictory_sources, published_at, observed_at, ingested_at,
       latency, signal, market_reaction, confirmation_count, contradiction_count, event_status
     ) values ($1,'x',$2,$3,null,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19,$20,now(),$21::jsonb,$22,$23,$24,$25,$26)
     on conflict (id) do update set
       impact_score = excluded.impact_score,
       confidence = excluded.confidence,
       market_relevance = excluded.market_relevance,
       observed_at = excluded.observed_at,
       ingested_at = now(),
       latency = excluded.latency,
       signal = excluded.signal,
       market_reaction = excluded.market_reaction,
       confirmation_count = excluded.confirmation_count,
       contradiction_count = excluded.contradiction_count,
       event_status = excluded.event_status`,
    [
      event.id,
      event.confidence,
      event.author,
      event.title,
      event.url,
      event.body,
      event.eventType,
      event.category,
      JSON.stringify(event.affectedAssets),
      event.sentiment,
      event.novelty,
      event.credibility,
      event.marketRelevance,
      event.impactScore,
      event.confidence,
      event.signalReason,
      JSON.stringify(["x"]),
      JSON.stringify([]),
      event.publishedAt,
      event.receivedAt,
      JSON.stringify(event.latency),
      event.signal,
      event.marketReaction,
      event.confirmationCount,
      event.contradictionCount,
      event.eventStatus,
    ],
  );
}

async function recordXLearningEvent(sql: Sql, event: XMarketEvent): Promise<void> {
  const marketState = JSON.stringify({
    reaction: event.marketReaction,
    confirmationCount: event.confirmationCount,
    contradictionCount: event.contradictionCount,
  });
  await sql.query(
    `insert into x_learning (
       id, post_id, username, tier, event_type, category, affected_assets,
       impact_score, confidence, detection_latency_ms, market_state, signal,
       market_reaction, event_outcome, reward, notes
     ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     on conflict (id) do nothing`,
    [
      `learn:${event.id}`,
      event.id.replace("x:", ""),
      event.username,
      event.tier,
      event.eventType,
      event.category,
      JSON.stringify(event.affectedAssets),
      event.marketImpactScore,
      event.confidence,
      event.latency.detectionLatencyMs,
      marketState,
      event.signal,
      event.marketReaction,
      "pending",
      null,
      `Latency-aware paper signal. Impact ${event.marketImpactScore}, confidence ${event.confidence}. ${event.signalReason}`,
    ],
  );
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

async function loadLatencyPercentiles(sql: Sql): Promise<XIntelligenceDashboard["latency"]> {
  const rows = await sql.query<{
    detection: number;
    classification: number;
    market: number;
    signal: number;
    total: number;
  }>(
    `select
       (latency->>'detectionLatencyMs')::double precision as detection,
       (latency->>'classificationLatencyMs')::double precision as classification,
       (latency->>'marketCheckLatencyMs')::double precision as market,
       (latency->>'signalLatencyMs')::double precision as signal,
       (latency->>'totalLatencyMs')::double precision as total
     from x_stream_posts
     where created_at > now() - interval '24 hours'`,
  );
  const detection = rows.map((r) => r.detection).filter((n) => Number.isFinite(n));
  const classification = rows.map((r) => r.classification).filter((n) => Number.isFinite(n));
  const market = rows.map((r) => r.market).filter((n) => Number.isFinite(n));
  const signal = rows.map((r) => r.signal).filter((n) => Number.isFinite(n));
  const total = rows.map((r) => r.total).filter((n) => Number.isFinite(n));

  const make = (arr: number[]): XLatencyPercentiles => ({
    p50: percentile(arr, 50),
    p95: percentile(arr, 95),
    p99: percentile(arr, 99),
    avg: arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null,
    max: arr.length ? Math.max(...arr) : null,
    count: arr.length,
  });

  return {
    detection: make(detection),
    classification: make(classification),
    marketCheck: make(market),
    signal: make(signal),
    total: make(total),
  };
}

async function loadAccountPerformance(sql: Sql): Promise<XAccountPerformance[]> {
  const rows = await sql.query<{
    username: string;
    tier: string;
    posts_analysed: number;
    market_moving_posts: number;
    total_impact: number;
  }>(
    `select username, tier, posts_analysed, market_moving_posts, total_impact
     from x_account_stats order by total_impact desc`,
  );
  return rows.map((r) => ({
    username: r.username,
    tier: r.tier as XAccountTier,
    postsAnalysed: num0(r.posts_analysed),
    marketMovingPosts: num0(r.market_moving_posts),
    precision: null, // requires labelled outcomes; not yet available
    avgImpact: num0(r.posts_analysed) > 0 ? num0(r.total_impact) / num0(r.posts_analysed) : null,
    avgLeadTimeMs: null,
  }));
}

async function loadRecentPosts(sql: Sql, limit = 50): Promise<XMarketEvent[]> {
  const rows = await sql.query<{
    id: string;
    username: string;
    tier: string;
    body: string;
    event_type: string;
    category: string;
    affected_assets: string;
    affected_sectors: string;
    impact_score: number;
    confidence: number;
    signal: string;
    market_reaction: string;
    confirmation_count: number;
    contradiction_count: number;
    latency: string;
    published_at: string | null;
    received_at: string;
    classified_at: string;
    created_at: string;
  }>(
    `select id, username, tier, body, event_type, category, affected_assets, affected_sectors,
            impact_score, confidence, signal, market_reaction, confirmation_count, contradiction_count,
            latency, published_at, received_at, classified_at, created_at
     from x_stream_posts
     order by created_at desc limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    source: "x",
    author: r.username,
    username: r.username,
    tier: r.tier as XAccountTier,
    title: r.body.slice(0, 240),
    body: r.body,
    url: `https://x.com/i/web/status/${r.id.replace("x:", "")}`,
    eventType: r.event_type as XMarketEvent["eventType"],
    category: r.category,
    affectedAssets: JSON.parse(r.affected_assets) as string[],
    affectedSectors: JSON.parse(r.affected_sectors) as string[],
    affectedCompanies: [],
    sentiment: null,
    novelty: 0,
    credibility: r.confidence,
    marketRelevance: 0,
    impactScore: r.impact_score / 100,
    marketImpactScore: r.impact_score,
    confidence: r.confidence,
    signal: r.signal as XMarketEvent["signal"],
    signalReason: "",
    marketReaction: r.market_reaction as XMarketEvent["marketReaction"],
    confirmationCount: r.confirmation_count,
    contradictionCount: r.contradiction_count,
    eventStatus: "preliminary",
    publishedAt: r.published_at,
    receivedAt: r.received_at,
    classifiedAt: r.classified_at,
    marketDataCheckedAt: r.classified_at,
    signalGeneratedAt: r.classified_at,
    latency: JSON.parse(r.latency) as XMarketEvent["latency"],
  }));
}

export async function getXIntelligence(): Promise<XIntelligenceDashboard> {
  await loadRuntimeSecrets();
  const sql = await getSql();
  const healthRows = await sql.query<XStreamHealth>(
    "select connected, last_event_at, reconnect_count, last_error, rate_limit_state from x_stream_health where id = 'main'",
  );
  const health = healthRows[0] ?? {
    connected: false,
    lastEventAt: null,
    reconnectCount: 0,
    lastError: xMarketEnabled() && !xBearer() ? "X_BEARER_TOKEN unset" : null,
    rateLimitState: null,
  };

  const summary = watchlistSummary();
  return {
    enabled: xMarketEnabled(),
    mode: xMarketMode(),
    health,
    watchlistSummary: summary,
    recentPosts: await loadRecentPosts(sql, 50),
    breakingEvents: await loadRecentPosts(sql, 20).then((posts) => posts.filter((p) => p.marketImpactScore >= xMinImpactScore())),
    accountPerformance: await loadAccountPerformance(sql),
    latency: await loadLatencyPercentiles(sql),
  };
}
