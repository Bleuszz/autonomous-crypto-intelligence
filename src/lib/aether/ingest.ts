import { getSql, dbSource, type Sql } from "@/lib/db";
import {
  DEFAULT_PORTFOLIO_ID,
  INGEST_POLL_MS,
  INGEST_TTL_MS,
  PAPER_ENGINE,
  PAPER_FEES,
  PRICE_TRADE_STALE_MS,
  RISK_LIMITS,
  SCORE_WEIGHTS,
  envStr,
} from "./config";
import { assessRug, checkOrderRisk } from "./risk";
import { scoreOpportunity, compareOpportunities } from "./scoring";
import { generateSignals } from "./signals";
import { gasForChain, pickLatencyMs, simulateFill } from "./paper";
import { evaluateLiveGates } from "./live";
import {
  extractEntities,
  fetchCoinGeckoGlobal,
  fetchCoinGeckoMarkets,
  fetchCoinbaseSpot,
  fetchDexScreenerDiscovery,
  fetchFearGreed,
  fetchKrakenOhlc,
  fetchNewPools,
  fetchNews,
  fetchPolymarket,
  fetchPoolTrades,
  fetchTokenSecurity,
  fetchTrending,
  fetchXRecent,
  type HealthPing,
  type NormalizedAsset,
  type NormalizedSocial,
} from "./sources";
import { fetchDeskExtras } from "./feeds";
import { decideEntries, decideExits, executableUsd, sizeUsd, type OpenPosition, type RegimeInput, type TradeIntent } from "./engine";
import { buildDigest, digestKey, loadLatestDigestMeta, londonSlot, rememberDigest, wasDigestSent } from "./digest";
import { sanitizePublicError } from "./privacy";
import { ageMs, formatAge, newsFreshness, nowIso } from "./time";
import { num0 } from "./math";
import type {
  AssetRow,
  BacktestDTO,
  CopySignalDTO,
  DetectedEventDTO,
  NewsDTO,
  OverviewDTO,
  PolymarketDTO,
  PortfolioDTO,
  RankedOpportunity,
  ResearchDTO,
  SignalDTO,
  SocialDTO,
  SourceHealth,
  SystemDTO,
  WalletDTO,
  WalletTxDTO,
  XUsageDTO,
} from "./types";
import { DEFAULT_MOMENTUM, runBuyHoldBenchmark, runMomentumBacktest, walkForwardSplit, type Candle } from "./backtest";
import { detectEvents } from "./events";
import {
  evaluateWalletPerformance,
  fetchPolymarketGlobalTrades,
  generateCopySignals,
  type PolymarketTrade,
  type WalletPerformanceV2,
} from "./wallet-intelligence";
import {
  buildDataQuality,
  computeFeatureAttributions,
  computeReward,
  ensureLearnerVersion,
  extractLesson,
  getLearnerDashboard,
  getLearnerOperatingState,
  getLearnerRecommendation,
  setLearnerOperatingState,
  recordDecisionSnapshot,
  recordOutcomeFromFills,
  rid as learningRid,
  runLearningJobs,
  jsonbField,
  type DecisionAction,
  type DecisionContext,
  type DecisionSnapshot,
  type LearnerDashboard,
  type LearnerOperatingMode,
  type LearnerRecommendation,
} from "./learning/index.ts";
import { runResearch } from "./research";
import { loadRuntimeSecrets } from "./secrets";
import { startDeskScheduler } from "./scheduler";
import { getXIntelligence, startXMarketStream } from "./x-market-intelligence";
import {
  X_DAILY_CAP,
  X_SEARCH_QUERY,
  X_WEEKLY_CAP,
  applyXCall,
  emptyXBudget,
  nextXCallAt,
  rollBudget,
  shouldCallX,
  type XBudgetState,
} from "./xbudget";

type Cache = {
  overview: OverviewDTO | null;
  lastIngestAt: number;
  ingesting: Promise<void> | null;
};

const g = globalThis as typeof globalThis & { __aetherCache?: Cache };
g.__aetherCache ??= { overview: null, lastIngestAt: 0, ingesting: null };
const cache = g.__aetherCache;

function xConfigured(): boolean {
  return Boolean(envStr("X_BEARER_TOKEN"));
}

function xUsageDto(budget: XBudgetState): XUsageDTO {
  const next = nextXCallAt(budget);
  return {
    configured: xConfigured(),
    callsToday: budget.callsToday,
    dailyCap: X_DAILY_CAP,
    callsWeek: budget.callsWeek,
    weeklyCap: X_WEEKLY_CAP,
    lastCallAt: budget.lastCallAt ? new Date(budget.lastCallAt).toISOString() : null,
    lastSuccessAt: budget.lastSuccessAt ? new Date(budget.lastSuccessAt).toISOString() : null,
    nextCallAt: next ? new Date(next).toISOString() : null,
    lastError: sanitizePublicError(budget.lastError),
    tweetsPulledWeek: budget.tweetsPulled,
  };
}

async function loadXBudget(sql: Sql): Promise<XBudgetState> {
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const file = path.join(process.cwd(), "secrets/x-budget.json");
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as XBudgetState;
      if (parsed && typeof parsed === "object") return rollBudget(parsed);
    }
  } catch {
    /* fall through to db */
  }
  const rows = await sql.query<{ value: unknown }>("select value from system_config where key = $1", ["x_api_budget"]);
  const v = rows[0]?.value;
  if (v && typeof v === "object" && !Array.isArray(v)) return rollBudget(v as XBudgetState);
  return emptyXBudget();
}

async function saveXBudget(sql: Sql, state: XBudgetState): Promise<void> {
  await sql.query(
    `insert into system_config (key, value, updated_at) values ('x_api_budget', $1::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [JSON.stringify(state)],
  );
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.join(process.cwd(), "secrets");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "x-budget.json"), JSON.stringify(state, null, 2));
  } catch {
    /* disk persist is best-effort */
  }
}

async function maybeFetchX(sql: Sql): Promise<{
  posts: NormalizedSocial[];
  health: HealthPing;
  budget: XBudgetState;
}> {
  const bearer = envStr("X_BEARER_TOKEN");
  let budget = await loadXBudget(sql);
  if (!bearer) {
    return {
      posts: [],
      health: { source: "x", status: "down", latencyMs: 0, error: "X_BEARER_TOKEN unset" },
      budget,
    };
  }
  const decision = shouldCallX(budget);
  if (!decision.ok) {
    const recent = budget.lastSuccessAt && Date.now() - budget.lastSuccessAt < 4 * 60 * 60 * 1000;
    return {
      posts: [],
      health: {
        source: "x",
        status: recent ? "up" : "degraded",
        latencyMs: 0,
        error: `throttled: ${decision.reason}`,
      },
      budget,
    };
  }
  const x = await fetchXRecent(X_SEARCH_QUERY, bearer);
  budget = applyXCall(budget, {
    ok: x.health.status === "up",
    status: x.status,
    error: x.health.error,
    tweets: x.posts.length,
  });
  await saveXBudget(sql, budget);
  return { posts: x.posts, health: x.health, budget };
}

const STOP_WORDS = new Set([
  "THE", "AND", "FOR", "ARE", "YOU", "NEW", "ALL", "BUT", "NOT", "ANY", "CAN", "OUR", "OUT",
  "NOW", "TOP", "LOW", "GAS", "FEE", "PER", "DAY", "USD", "NFT", "DAO", "CEO", "ETF",
]);

function rid(): string {
  return crypto.randomUUID();
}

function sourceReliabilityFor(source: string, healthMap: Map<string, HealthPing>): number {
  const h = healthMap.get(source);
  if (!h) return 0.7;
  if (h.status === "down") return 0.2;
  if (h.status === "degraded") return 0.6;
  const base = 0.85;
  // Latency penalty: >10s starts to degrade.
  if (h.latencyMs && h.latencyMs > 10_000) return base - Math.min(0.3, (h.latencyMs - 10_000) / 60_000);
  return base;
}

async function recordHealth(sql: Sql, list: HealthPing[]) {
  for (const h of list) {
    await sql.query(
      `insert into source_health (id, source, status, latency_ms, last_success_at, last_error_at, last_error, calls, failures, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,1,$8,now())
       on conflict (source) do update set
         status = excluded.status,
         latency_ms = excluded.latency_ms,
         last_success_at = coalesce(excluded.last_success_at, source_health.last_success_at),
         last_error_at = case when excluded.status = 'down' then now() else source_health.last_error_at end,
         last_error = excluded.last_error,
         calls = source_health.calls + 1,
         failures = source_health.failures + excluded.failures,
         updated_at = now()`,
      [
        h.source,
        h.source,
        h.status,
        h.latencyMs,
        h.status === "down" ? null : nowIso(),
        h.status === "down" ? nowIso() : null,
        sanitizePublicError(h.error),
        h.status === "down" ? 1 : 0,
      ],
    );
  }
}

async function upsertAssets(sql: Sql, assets: NormalizedAsset[]) {
  for (const a of assets) {
    await sql.query(
      `insert into assets (
         id, symbol, name, kind, chain_id, contract_address, coingecko_id, image_url,
         price_usd, market_cap_usd, fdv_usd, volume_24h_usd, liquidity_usd,
         change_1h_pct, change_24h_pct, change_7d_pct, pair_created_at, sparkline_7d,
         source, source_reliability, observed_at, source_timestamp, ingested_at, processed_at, updated_at
       ) values (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,now(),now(),now()
       )
       on conflict (id) do update set
         symbol = excluded.symbol,
         name = excluded.name,
         kind = excluded.kind,
         chain_id = coalesce(excluded.chain_id, assets.chain_id),
         contract_address = coalesce(excluded.contract_address, assets.contract_address),
         coingecko_id = coalesce(excluded.coingecko_id, assets.coingecko_id),
         image_url = coalesce(excluded.image_url, assets.image_url),
         price_usd = coalesce(excluded.price_usd, assets.price_usd),
         market_cap_usd = coalesce(excluded.market_cap_usd, assets.market_cap_usd),
         fdv_usd = coalesce(excluded.fdv_usd, assets.fdv_usd),
         volume_24h_usd = coalesce(excluded.volume_24h_usd, assets.volume_24h_usd),
         liquidity_usd = coalesce(excluded.liquidity_usd, assets.liquidity_usd),
         change_1h_pct = coalesce(excluded.change_1h_pct, assets.change_1h_pct),
         change_24h_pct = coalesce(excluded.change_24h_pct, assets.change_24h_pct),
         change_7d_pct = coalesce(excluded.change_7d_pct, assets.change_7d_pct),
         pair_created_at = coalesce(excluded.pair_created_at, assets.pair_created_at),
         sparkline_7d = coalesce(excluded.sparkline_7d, assets.sparkline_7d),
         source = excluded.source,
         source_reliability = excluded.source_reliability,
         observed_at = excluded.observed_at,
         ingested_at = now(),
         processed_at = now(),
         updated_at = now()`,
      [
        a.id, a.symbol, a.name, a.kind, a.chainId, a.contractAddress, a.coingeckoId, a.imageUrl,
        a.priceUsd, a.marketCapUsd, a.fdvUsd, a.volume24hUsd, a.liquidityUsd,
        a.change1hPct, a.change24hPct, a.change7dPct, a.pairCreatedAt,
        a.sparkline7d ? JSON.stringify(a.sparkline7d) : null,
        a.source, a.sourceReliability, a.observedAt, a.sourceTimestamp,
      ],
    );
  }
}

function rowAsset(r: Record<string, unknown>): AssetRow {
  let spark: number[] | null = null;
  const raw = r.sparkline_7d;
  if (Array.isArray(raw)) spark = raw.map(Number).filter(Number.isFinite);
  else if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw) as unknown;
      if (Array.isArray(p)) spark = p.map(Number).filter(Number.isFinite);
    } catch {
      spark = null;
    }
  }
  const observedAt = r.observed_at ? String(r.observed_at) : null;
  return {
    id: String(r.id),
    symbol: String(r.symbol),
    name: String(r.name),
    kind: String(r.kind),
    chainId: r.chain_id ? String(r.chain_id) : null,
    contractAddress: r.contract_address ? String(r.contract_address) : null,
    coingeckoId: r.coingecko_id ? String(r.coingecko_id) : null,
    imageUrl: r.image_url ? String(r.image_url) : null,
    priceUsd: num0(r.price_usd) || null,
    marketCapUsd: r.market_cap_usd == null ? null : num0(r.market_cap_usd),
    fdvUsd: r.fdv_usd == null ? null : num0(r.fdv_usd),
    volume24hUsd: r.volume_24h_usd == null ? null : num0(r.volume_24h_usd),
    liquidityUsd: r.liquidity_usd == null ? null : num0(r.liquidity_usd),
    change1hPct: r.change_1h_pct == null ? null : num0(r.change_1h_pct),
    change24hPct: r.change_24h_pct == null ? null : num0(r.change_24h_pct),
    change7dPct: r.change_7d_pct == null ? null : num0(r.change_7d_pct),
    pairCreatedAt: r.pair_created_at ? String(r.pair_created_at) : null,
    sparkline7d: spark,
    source: r.source ? String(r.source) : null,
    sourceReliability: num0(r.source_reliability),
    observedAt,
    ingestedAt: r.ingested_at ? String(r.ingested_at) : null,
    dataAgeMs: ageMs(observedAt),
  };
}

async function applySell(opts: {
  sql: Sql;
  pos: { id: unknown; asset_id: string; qty: number; avg_price: number; opened_at?: string };
  r: RankedOpportunity | undefined;
  mark: number;
  intent: TradeIntent;
  cash: number;
  realized: number;
}): Promise<{ cash: number; realized: number; closed: boolean; fill: { qty: number; price: number; notionalUsd: number; feeUsd: number; gasUsd: number; slippageBps: number; latencyMs: number; model: string } | null; sellQty: number; entryPrice: number; realizedPnlUsd: number; openedAt: string | null }> {
  const { sql, pos, r, mark, intent } = opts;
  let { cash, realized } = opts;
  const frac = clamp01(intent.fraction);
  const qty = pos.qty * frac;
  const notional = qty * mark;
  const fill = simulateFill({
    side: "sell",
    mid: mark,
    notionalUsd: notional,
    liquidityUsd: r ? executableUsd(r) : 1_000_000,
    volatilityPct: Math.abs(r?.asset.change24hPct ?? 5),
    latencyMs: pickLatencyMs(`exit:${pos.asset_id}:${intent.strategyId}`),
    gasUsd: gasForChain(r?.asset.chainId),
    seed: `exit:${pos.asset_id}:${intent.strategyId}:${Date.now()}`,
  });
  if (!fill.ok) return { cash, realized, closed: false, fill: null, sellQty: 0, entryPrice: opts.pos.avg_price, realizedPnlUsd: 0, openedAt: opts.pos.opened_at ?? null };
  const proceeds = fill.qty * fill.price - fill.feeUsd - fill.gasUsd;
  const costBasis = qty * pos.avg_price;
  cash += proceeds;
  realized += proceeds - costBasis;
  const oid = rid();
  await sql.query(
    `insert into paper_orders (id, portfolio_id, asset_id, side, type, status, requested_notional_usd, submitted_at, available_at, reason, latency_ms, assumed_mid)
     values ($1,$2,$3,'sell','market','filled',$4,now(),now(),$5,$6,$7)`,
    [oid, DEFAULT_PORTFOLIO_ID, pos.asset_id, notional, intent.reason.slice(0, 240), fill.latencyMs, mark],
  );
  await sql.query(
    `insert into paper_fills (id, order_id, portfolio_id, asset_id, side, qty, price, notional_usd, fee_usd, slippage_bps, gas_usd, filled_at, model)
     values ($1,$2,$3,$4,'sell',$5,$6,$7,$8,$9,$10,now(),$11)`,
    [rid(), oid, DEFAULT_PORTFOLIO_ID, pos.asset_id, fill.qty, fill.price, fill.notionalUsd, fill.feeUsd, fill.slippageBps, fill.gasUsd, fill.model],
  );
  const openedAt = opts.pos.opened_at ?? nowIso();
  if (frac >= 0.999) {
    await sql.query("delete from positions where id = $1", [pos.id]);
    return { cash, realized, closed: true, fill, sellQty: qty, entryPrice: opts.pos.avg_price, realizedPnlUsd: proceeds - costBasis, openedAt };
  }
  await sql.query("update positions set qty = qty - $2, updated_at = now() where id = $1", [pos.id, fill.qty]);
  return { cash, realized, closed: false, fill, sellQty: qty, entryPrice: opts.pos.avg_price, realizedPnlUsd: proceeds - costBasis, openedAt };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0.05, n));
}

async function latestOpenEntrySnapshot(sql: Sql, assetId: string): Promise<string | null> {
  const rows = await sql.query<{ id: string }>(
    `select s.id from trade_decision_snapshots s
     where s.asset_id = $1 and s.decision = 'ENTER' and s.side = 'buy'
       and not exists (select 1 from trade_outcomes o where o.decision_snapshot_id = s.id)
     order by s.action_at desc limit 1`,
    [assetId],
  );
  return rows[0]?.id ?? null;
}

function entrySnapshotContext(
  r: RankedOpportunity,
  intent: TradeIntent,
  fill: { qty: number; price: number; notionalUsd: number; feeUsd: number; gasUsd: number; slippageBps: number; latencyMs: number; model: string },
  gate: { ok: boolean; reasons: string[] },
  equity: number,
  cash: number,
  dayAnchor: number,
  signalId?: string | null,
  orderId?: string | null,
  learnerRec?: LearnerRecommendation | null,
  actualDecision: DecisionAction = "ENTER",
): DecisionContext {
  const sizing = {
    equityUsd: equity,
    cashUsd: cash,
    requestedNotionalUsd: fill.notionalUsd,
    approvedNotionalUsd: fill.notionalUsd,
    positionSizePct: equity > 0 ? fill.notionalUsd / equity : 0,
  };
  const exec = {
    latencyMs: fill.latencyMs,
    feeBps: 30,
    baseSlippageBps: fill.slippageBps,
    model: fill.model,
    expectedFillPrice: fill.price,
  };
  const freshness: "NEW" | "RECENT" | "STALE" | "UNKNOWN" =
    (r.asset.dataAgeMs ?? Infinity) < 60_000 ? "NEW" : (r.asset.dataAgeMs ?? Infinity) < 300_000 ? "RECENT" : "STALE";
  const dataQuality = buildDataQuality({
    priceFresh: freshness === "NEW" || freshness === "RECENT",
    dataAgeMs: r.asset.dataAgeMs,
    sourceReliability: r.asset.sourceReliability,
    source: r.asset.source,
    stalenessFlags: freshness === "STALE" ? ["price_stale"] : [],
  });
  const _riskState = {
    positionPctOfEquity: sizing.positionSizePct,
    tokenConcentrationPct: sizing.positionSizePct,
    chainExposurePct: sizing.positionSizePct,
    liquidityTakePct: 0,
    slippageBps: fill.slippageBps,
    dailyLossUsedPct: equity > 0 ? Math.abs(equity - dayAnchor) / equity : 0,
    hardLimitsHit: gate.ok ? [] : gate.reasons,
  };
  return {
    assetId: r.asset.id,
    symbol: r.asset.symbol,
    decision: actualDecision,
    baselineAction: "ENTER",
    side: "buy",
    strategyId: intent.strategyId,
    strategyVersion: "2.0.0",
    signalId: signalId ?? null,
    orderId: orderId ?? null,
    ranked: r,
    intent,
    sizing,
    execution: exec,
    dataQuality,
    learnerRecommendation: learnerRec ?? null,
    confidence: intent.confidence,
    notes: `Baseline ENTER; actual ${actualDecision}; learner ${learnerRec ? learnerRec.action : "not consulted"}; gate ${gate.ok ? "ok" : "rejected"}`,
  };
}

function exitSnapshotContext(
  r: RankedOpportunity | undefined,
  intent: TradeIntent,
  fill: { qty: number; price: number; notionalUsd: number; feeUsd: number; gasUsd: number; slippageBps: number; latencyMs: number; model: string },
): DecisionContext {
  return {
    assetId: intent.assetId,
    symbol: intent.symbol,
    decision: "EXIT",
    baselineAction: "EXIT",
    side: "sell",
    strategyId: intent.strategyId,
    strategyVersion: "2.0.0",
    ranked: r,
    intent,
    execution: {
      latencyMs: fill.latencyMs,
      feeBps: 30,
      baseSlippageBps: fill.slippageBps,
      model: fill.model,
      expectedFillPrice: fill.price,
    },
    dataQuality: buildDataQuality({ priceFresh: true, dataAgeMs: null, sourceReliability: 0.7, source: null, stalenessFlags: [] }),
    confidence: intent.confidence,
    notes: `Exit via ${intent.reason}`,
  };
}

async function paperTick(sql: Sql, ranked: RankedOpportunity[], signals: SignalDTO[], regime: RegimeInput) {
  const pRows = await sql.query<Record<string, unknown>>("select * from paper_portfolios where id = $1", [DEFAULT_PORTFOLIO_ID]);
  const p = pRows[0];
  if (!p) return;
  const learnerState = await getLearnerOperatingState(sql);
  const learnerMode = learnerState.mode;
  const posRows = await sql.query<Record<string, unknown>>("select * from positions where portfolio_id = $1", [DEFAULT_PORTFOLIO_ID]);
  const marks = new Map(ranked.map((r) => [r.asset.id, r.asset.priceUsd]));
  let cash = num0(p.cash_usd);
  let realized = num0(p.realized_pnl_usd);
  const today = new Date().toISOString().slice(0, 10);
  let dayAnchor = num0(p.day_anchor_equity_usd) || num0(p.equity_usd);
  if (String(p.day_anchor_date ?? "") !== today) {
    dayAnchor = num0(p.equity_usd);
    await sql.query(
      "update paper_portfolios set day_anchor_equity_usd = $2, day_anchor_date = $3 where id = $1",
      [DEFAULT_PORTFOLIO_ID, dayAnchor, today],
    );
  }

  const openForExit: OpenPosition[] = posRows.map((pos) => ({
    id: String(pos.id),
    assetId: String(pos.asset_id),
    qty: num0(pos.qty),
    avgPrice: num0(pos.avg_price),
    openedAt: String(pos.opened_at ?? nowIso()),
    peakMark: pos.peak_mark_usd == null ? null : num0(pos.peak_mark_usd),
  }));

  for (const pos of posRows) {
    const assetId = String(pos.asset_id);
    const mark = marks.get(assetId) ?? num0(pos.avg_price);
    if (mark > 0) {
      try {
        await sql.query(
          "update positions set peak_mark_usd = greatest(coalesce(peak_mark_usd, 0), $2), last_mark_usd = $2, updated_at = now() where id = $1",
          [pos.id, mark],
        );
      } catch {
        /* column may not exist until 0003 applies */
      }
    }
  }

  const exits = decideExits({ positions: openForExit, ranked, signals, regime });
  const exited = new Set<string>();
  for (const intent of exits) {
    const pos = posRows.find((row) => String(row.asset_id) === intent.assetId);
    if (!pos || exited.has(intent.assetId)) continue;
    const mark = marks.get(intent.assetId) ?? num0(pos.avg_price);
    const r = ranked.find((x) => x.asset.id === intent.assetId);
    const res = await applySell({
      sql,
      pos: { id: pos.id, asset_id: String(pos.asset_id), qty: num0(pos.qty), avg_price: num0(pos.avg_price), opened_at: String(pos.opened_at ?? nowIso()) },
      r,
      mark,
      intent,
      cash,
      realized,
    });
    cash = res.cash;
    realized = res.realized;
    if (res.closed) exited.add(intent.assetId);
    // Learning: record EXIT decision snapshot and, when fully closed, round-trip outcome + reward.
    if (res.fill) {
      try {
        const exitCtx = exitSnapshotContext(r, intent, res.fill);
        await recordDecisionSnapshot(sql, exitCtx);
        if (res.closed) {
          const entryId = await latestOpenEntrySnapshot(sql, intent.assetId);
          if (entryId) {
            const holdingSeconds = (Date.now() - new Date(res.openedAt ?? nowIso()).getTime()) / 1000;
            const outcome = await recordOutcomeFromFills(sql, {
              entrySnapshotId: entryId,
              assetId: intent.assetId,
              entryPrice: res.entryPrice,
              exitPrice: res.fill.price,
              qty: res.sellQty,
              realizedPnlUsd: res.realizedPnlUsd,
              feesUsd: res.fill.feeUsd,
              gasUsd: res.fill.gasUsd,
              slippageBps: res.fill.slippageBps,
              holdingSeconds,
              exitReason: intent.reason,
              stopHit: intent.strategyId === "exit_stop_v2",
              targetHit: intent.strategyId === "exit_take_v2",
            });
            // Fetch the entry snapshot to compute reward and attribution.
            const snapRows = await sql.query<{
              id: string;
              features: string;
              market_structure: string;
              regime: string;
              evidence: string;
              risk_state: string;
              sizing: string | null;
              execution_assumptions: string | null;
              data_quality: string;
              expected_value: number | null;
              confidence: number | null;
              learner_recommendation: string | null;
              notes: string | null;
              asset_id: string;
              symbol: string;
              decision: string;
              baseline_action: string | null;
              side: string | null;
              action_at: string;
              strategy_id: string;
              strategy_version: string;
              learner_version: string;
              signal_id: string | null;
              order_id: string | null;
              portfolio_id: string;
            }>(
              `select * from trade_decision_snapshots where id = $1`,
              [entryId],
            );
            const snapRow = snapRows[0];
            if (snapRow) {
              const snapshot: DecisionSnapshot = {
                id: snapRow.id,
                portfolioId: snapRow.portfolio_id,
                assetId: snapRow.asset_id,
                symbol: snapRow.symbol,
                decision: snapRow.decision as DecisionSnapshot["decision"],
                baselineAction: snapRow.baseline_action as DecisionSnapshot["baselineAction"],
                side: snapRow.side as DecisionSnapshot["side"],
                actionAt: snapRow.action_at,
                strategyId: snapRow.strategy_id,
                strategyVersion: snapRow.strategy_version,
                learnerVersion: snapRow.learner_version,
                signalId: snapRow.signal_id,
                orderId: snapRow.order_id,
                features: jsonbField<DecisionSnapshot["features"]>(snapRow.features) ?? ({} as DecisionSnapshot["features"]),
                marketStructure: jsonbField<DecisionSnapshot["marketStructure"]>(snapRow.market_structure) ?? ({} as DecisionSnapshot["marketStructure"]),
                regime: jsonbField<Record<string, string | number | boolean | null>>(snapRow.regime) ?? {},
                evidence: jsonbField<DecisionSnapshot["evidence"]>(snapRow.evidence) ?? ({} as DecisionSnapshot["evidence"]),
                riskState: jsonbField<DecisionSnapshot["riskState"]>(snapRow.risk_state) ?? ({} as DecisionSnapshot["riskState"]),
                sizing: jsonbField<DecisionSnapshot["sizing"]>(snapRow.sizing),
                executionAssumptions: jsonbField<DecisionSnapshot["executionAssumptions"]>(snapRow.execution_assumptions),
                dataQuality: jsonbField<DecisionSnapshot["dataQuality"]>(snapRow.data_quality) ?? ({} as DecisionSnapshot["dataQuality"]),
                expectedValue: snapRow.expected_value,
                confidence: snapRow.confidence,
                learnerRecommendation: jsonbField<DecisionSnapshot["learnerRecommendation"]>(snapRow.learner_recommendation),
                notes: snapRow.notes,
                createdAt: snapRow.action_at,
              };
              const reward = computeReward(snapshot, outcome);
              await sql.query(
                `insert into trade_rewards (
                   id, outcome_id, decision_snapshot_id, total_reward, outcome_quality, decision_quality, execution_quality,
                   risk_discipline, drawdown_penalty, slippage_penalty, fee_penalty, contradiction_penalty, avoidable_loss,
                   decision_outcome_class, version
                 ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
                [
                  reward.id, reward.outcomeId, reward.decisionSnapshotId, reward.totalReward, reward.components.outcomeQuality,
                  reward.components.decisionQuality, reward.components.executionQuality, reward.components.riskDiscipline,
                  reward.components.drawdownPenalty, reward.components.slippagePenalty, reward.components.feePenalty,
                  reward.components.contradictionPenalty, reward.avoidableLoss, reward.decisionOutcomeClass, reward.version,
                ],
              );
              const attributions = computeFeatureAttributions(snapshot, outcome, reward.id);
              for (const a of attributions) {
                await sql.query(
                  `insert into feature_attributions (id, reward_id, feature_name, contribution, conditional_expectancy, evidence)
                   values ($1,$2,$3,$4,$5,$6)
                   on conflict (reward_id, feature_name) do nothing`,
                  [a.id, a.rewardId, a.featureName, a.contribution, a.conditionalExpectancy, a.evidence],
                );
              }
              const lesson = extractLesson(snapshot, reward, attributions);
              await sql.query(
                `insert into lesson_registry (id, pattern_id, trade_reward_id, lesson_type, title, body, evidence, confidence)
                 values ($1, null, $2, $3, $4, $5, $6::jsonb, $7)`,
                [learningRid(), reward.id, reward.totalReward >= 0 ? "POSITIVE" : "NEGATIVE", lesson.title, lesson.body, JSON.stringify(lesson.evidence), lesson.confidence],
              );
            }
          }
        }
      } catch (e) {
        if (process.env.NODE_ENV !== "production") {
          console.error("[learning] failed to record exit/outcome:", e instanceof Error ? e.message : e);
        }
      }
    }
    await sql.query(
      `insert into alerts (id, kind, severity, title, body, asset_id, created_at, channel)
       values ($1,'paper_trade','info',$2,$3,$4,now(),'in-app')`,
      [rid(), `Paper SELL ${intent.symbol}`, intent.reason.slice(0, 240), intent.assetId],
    );
  }

  const openPos = await sql.query<{ asset_id: string; qty: number; avg_price: number }>(
    "select asset_id, qty, avg_price from positions where portfolio_id = $1",
    [DEFAULT_PORTFOLIO_ID],
  );
  const held = new Set(openPos.map((x) => x.asset_id));
  let equity = cash;
  for (const pos of openPos) {
    const mark = marks.get(pos.asset_id) ?? pos.avg_price;
    equity += pos.qty * mark;
  }

  const entries = decideEntries({
    ranked,
    signals,
    held,
    regime,
    openCount: openPos.length,
  });

  for (const intent of entries) {
    const r = ranked.find((x) => x.asset.id === intent.assetId);
    if (!r || !r.asset.priceUsd || held.has(intent.assetId)) continue;
    const size = sizeUsd({ equity, cash, confidence: intent.confidence, r, regime });
    if (size < PAPER_ENGINE.minOrderUsd) continue;
    const slipBps = PAPER_FEES.baseSlippageBps + (size / Math.max(executableUsd(r), 1)) * 8500;
    const chainNotional = openPos
      .filter((p0) => ranked.find((x) => x.asset.id === p0.asset_id)?.asset.chainId === r.asset.chainId)
      .reduce((a, p0) => a + p0.qty * (marks.get(p0.asset_id) ?? p0.avg_price), 0);
    const gate = checkOrderRisk({
      equity,
      cash,
      requestedNotional: size,
      dayPnlUsd: equity - dayAnchor,
      tokenNotionalAfter: size,
      chainNotionalAfter: chainNotional + size,
      liquidityUsd: executableUsd(r),
      slippageBps: slipBps,
      startingEquity: num0(p?.starting_equity_usd) || equity,
      limits: RISK_LIMITS,
    });
    const latency = pickLatencyMs(intent.strategyId + intent.assetId);
    const oid = rid();
    if (!gate.ok) {
      await sql.query(
        `insert into paper_orders (id, portfolio_id, asset_id, side, type, status, requested_notional_usd, submitted_at, available_at, reason, latency_ms, assumed_mid)
         values ($1,$2,$3,'buy','market','rejected',$4,now(),now(),$5,$6,$7)`,
        [oid, DEFAULT_PORTFOLIO_ID, intent.assetId, size, gate.reasons.join("; ").slice(0, 240), latency, r.asset.priceUsd],
      );
      continue;
    }
    const fill = simulateFill({
      side: "buy",
      mid: r.asset.priceUsd,
      notionalUsd: size,
      liquidityUsd: executableUsd(r),
      volatilityPct: Math.abs(r.asset.change24hPct ?? 8),
      latencyMs: latency,
      gasUsd: gasForChain(r.asset.chainId),
      seed: `buy:${intent.strategyId}:${intent.assetId}`,
    });
    if (!fill.ok) {
      await sql.query(
        `insert into paper_orders (id, portfolio_id, asset_id, side, type, status, requested_notional_usd, submitted_at, available_at, reason, latency_ms, assumed_mid)
         values ($1,$2,$3,'buy','market','rejected',$4,now(),now(),$5,$6,$7)`,
        [oid, DEFAULT_PORTFOLIO_ID, intent.assetId, size, (fill.rejectReason ?? "rejected").slice(0, 240), latency, r.asset.priceUsd],
      );
      continue;
    }
    const cost = fill.notionalUsd + fill.feeUsd + fill.gasUsd;
    if (cost > cash) {
      await sql.query(
        `insert into paper_orders (id, portfolio_id, asset_id, side, type, status, requested_notional_usd, submitted_at, available_at, reason, latency_ms, assumed_mid)
         values ($1,$2,$3,'buy','market','rejected',$4,now(),now(),$5,$6,$7)`,
        [oid, DEFAULT_PORTFOLIO_ID, intent.assetId, size, "Insufficient cash after fill costs", latency, r.asset.priceUsd],
      );
      continue;
    }
    let learnerRec: LearnerRecommendation | null = null;
    let actualDecision: DecisionAction = "ENTER";
    if (learnerMode !== "DISABLED") {
      try {
        const baseCtx = entrySnapshotContext(r, intent, fill, gate, equity, cash, dayAnchor, null, oid, null);
        const rec = await getLearnerRecommendation(sql, baseCtx);
        learnerRec = rec.recommendation;
        if (learnerMode === "ACTIVE" && learnerRec.action !== "ENTER") {
          actualDecision = learnerRec.action;
        }
      } catch (e) {
        if (process.env.NODE_ENV !== "production") {
          console.error("[learning] failed to consult learner:", e instanceof Error ? e.message : e);
        }
      }
    }

    if (actualDecision !== "ENTER") {
      // ACTIVE mode: learner overrode the baseline. Record the non-enter snapshot and skip execution.
      try {
        const ctx = entrySnapshotContext(r, intent, fill, gate, equity, cash, dayAnchor, null, oid, learnerRec, actualDecision);
        await recordDecisionSnapshot(sql, ctx);
      } catch (e) {
        if (process.env.NODE_ENV !== "production") {
          console.error("[learning] failed to record learner-override snapshot:", e instanceof Error ? e.message : e);
        }
      }
      await sql.query(
        `insert into alerts (id, kind, severity, title, body, asset_id, created_at, channel)
         values ($1,'paper_trade','info',$2,$3,$4,now(),'in-app')`,
        [rid(), `Learner override ${r.asset.symbol}`, `Baseline ENTER blocked by learner ${actualDecision} (${intent.strategyId})`, intent.assetId],
      );
      continue;
    }

    cash -= cost;
    await sql.query(
      `insert into paper_orders (id, portfolio_id, asset_id, side, type, status, requested_notional_usd, submitted_at, available_at, reason, latency_ms, assumed_mid)
       values ($1,$2,$3,'buy','market','filled',$4,now(),now(),$5,$6,$7)`,
      [oid, DEFAULT_PORTFOLIO_ID, intent.assetId, size, intent.reason.slice(0, 240), latency, r.asset.priceUsd],
    );
    await sql.query(
      `insert into paper_fills (id, order_id, portfolio_id, asset_id, side, qty, price, notional_usd, fee_usd, slippage_bps, gas_usd, filled_at, model)
       values ($1,$2,$3,$4,'buy',$5,$6,$7,$8,$9,$10,now(),$11)`,
      [rid(), oid, DEFAULT_PORTFOLIO_ID, intent.assetId, fill.qty, fill.price, fill.notionalUsd, fill.feeUsd, fill.slippageBps, fill.gasUsd, fill.model],
    );
    await sql.query(
      `insert into positions (id, portfolio_id, asset_id, qty, avg_price, opened_at, updated_at)
       values ($1,$2,$3,$4,$5,now(),now())
       on conflict (portfolio_id, asset_id) do update set
         qty = positions.qty + excluded.qty,
         avg_price = (positions.avg_price * positions.qty + excluded.avg_price * excluded.qty) / nullif(positions.qty + excluded.qty, 0),
         updated_at = now()`,
      [rid(), DEFAULT_PORTFOLIO_ID, intent.assetId, fill.qty, fill.price],
    );
    try {
      await sql.query(
        "update positions set peak_mark_usd = $2, last_mark_usd = $2 where portfolio_id = $1 and asset_id = $3",
        [DEFAULT_PORTFOLIO_ID, fill.price, intent.assetId],
      );
    } catch {
      /* optional columns */
    }
    held.add(intent.assetId);
    // Learning: record the executed decision snapshot with the learner recommendation consulted before acting.
    try {
      const ctx = entrySnapshotContext(r, intent, fill, gate, equity, cash, dayAnchor, null, oid, learnerRec, "ENTER");
      await recordDecisionSnapshot(sql, ctx);
    } catch (e) {
      /* learning schema may not be ready; do not break paper trading */
      if (process.env.NODE_ENV !== "production") {
        console.error("[learning] failed to record entry snapshot:", e instanceof Error ? e.message : e);
      }
    }
    await sql.query(
      `insert into alerts (id, kind, severity, title, body, asset_id, created_at, channel)
       values ($1,'paper_trade','info',$2,$3,$4,now(),'in-app')`,
      [rid(), `Paper BUY ${r.asset.symbol}`, `Filled ${fill.qty} @ ${fill.price} (${intent.strategyId}, slip ${fill.slippageBps} bps)`, intent.assetId],
    );
  }

  const pos2 = await sql.query<{ asset_id: string; qty: number; avg_price: number }>(
    "select asset_id, qty, avg_price from positions where portfolio_id = $1",
    [DEFAULT_PORTFOLIO_ID],
  );
  equity = cash;
  for (const pos of pos2) {
    const mark = marks.get(pos.asset_id) ?? pos.avg_price;
    equity += pos.qty * mark;
  }
  const peak = Math.max(num0(p.peak_equity_usd), equity);
  const dd = peak > 0 ? (peak - equity) / peak : 0;
  const maxDd = Math.max(num0(p.max_drawdown_pct), dd);
  const dayPnl = equity - dayAnchor;
  await sql.query(
    `update paper_portfolios set cash_usd=$2, equity_usd=$3, realized_pnl_usd=$4, peak_equity_usd=$5, max_drawdown_pct=$6, day_pnl_usd=$7, updated_at=now() where id=$1`,
    [DEFAULT_PORTFOLIO_ID, cash, equity, realized, peak, maxDd, dayPnl],
  );
  await sql.query(
    `insert into portfolio_snapshots (id, portfolio_id, equity_usd, cash_usd, realized_pnl_usd, unrealized_pnl_usd, drawdown_pct, observed_at)
     values ($1,$2,$3,$4,$5,$6,$7,now())`,
    [rid(), DEFAULT_PORTFOLIO_ID, equity, cash, realized, equity - cash - realized, dd],
  );
}

async function assemblePortfolio(sql: Sql, ranked: RankedOpportunity[]): Promise<PortfolioDTO> {
  const p = (await sql.query<Record<string, unknown>>("select * from paper_portfolios where id = $1", [DEFAULT_PORTFOLIO_ID]))[0];
  const marks = new Map(ranked.map((r) => [r.asset.id, r]));
  const pos = await sql.query<Record<string, unknown>>("select * from positions where portfolio_id = $1", [DEFAULT_PORTFOLIO_ID]);
  const assets = await sql.query<{ id: string; symbol: string; name: string; chain_id: string | null; price_usd: number | null }>(
    "select id, symbol, name, chain_id, price_usd from assets",
  );
  const amap = new Map(assets.map((a) => [a.id, a]));
  const positions = pos.map((row) => {
    const id = String(row.asset_id);
    const meta = amap.get(id);
    const qty = num0(row.qty);
    const avg = num0(row.avg_price);
    const mark = marks.get(id)?.asset.priceUsd ?? meta?.price_usd ?? avg;
    const notional = qty * mark;
    const upnl = (mark - avg) * qty;
    return {
      id: String(row.id),
      assetId: id,
      symbol: meta?.symbol ?? id,
      name: meta?.name ?? id,
      qty,
      avgPrice: avg,
      mark,
      notionalUsd: notional,
      unrealizedPnlUsd: upnl,
      unrealizedPnlPct: avg ? ((mark - avg) / avg) * 100 : 0,
      openedAt: String(row.opened_at),
      chainId: meta?.chain_id ?? marks.get(id)?.asset.chainId ?? null,
    };
  });
  const fills = await sql.query<Record<string, unknown>>(
    `select f.*, a.symbol from paper_fills f left join assets a on a.id = f.asset_id
     where f.portfolio_id = $1 order by f.filled_at desc limit 40`,
    [DEFAULT_PORTFOLIO_ID],
  );
  const orders = await sql.query<Record<string, unknown>>(
    `select o.*, a.symbol from paper_orders o left join assets a on a.id = o.asset_id
     where o.portfolio_id = $1 order by o.submitted_at desc limit 40`,
    [DEFAULT_PORTFOLIO_ID],
  );
  const snaps = await sql.query<{ observed_at: string; equity_usd: number }>(
    `select observed_at, equity_usd from portfolio_snapshots where portfolio_id = $1 order by observed_at asc limit 400`,
    [DEFAULT_PORTFOLIO_ID],
  );
  const feesPaidUsd = fills.reduce((a, f) => a + num0(f.fee_usd) + num0(f.gas_usd), 0);
  const slippagePaidUsd = fills.reduce((a, f) => a + (num0(f.notional_usd) * num0(f.slippage_bps)) / 10_000, 0);
  const cash = num0(p?.cash_usd);
  const unreal = positions.reduce((a, x) => a + x.unrealizedPnlUsd, 0);
  const equity = cash + positions.reduce((a, x) => a + x.notionalUsd, 0);
  const start = num0(p?.starting_equity_usd) || 10_000;
  const dayPnl = num0(p?.day_pnl_usd);

  // Round-trip realized P&L and win rate from fills, not from currently open positions.
  const buyFillsByAsset = new Map<string, { qty: number; cost: number }[]>();
  for (const f of fills) {
    if (f.side !== "buy") continue;
    const assetId = String(f.asset_id);
    const arr = buyFillsByAsset.get(assetId) ?? [];
    const qty = num0(f.qty);
    // cash cost of the buy fill = gross notional + fee + gas
    arr.push({ qty, cost: num0(f.notional_usd) + num0(f.fee_usd) + num0(f.gas_usd) });
    buyFillsByAsset.set(assetId, arr);
  }
  let roundTrips = 0;
  let roundTripWins = 0;
  let roundTripLosses = 0;
  const realizedFromFills: number[] = [];
  for (const sell of fills.filter((f) => f.side === "sell")) {
    const assetId = String(sell.asset_id);
    const sells = { qty: num0(sell.qty), proceeds: num0(sell.notional_usd) - num0(sell.fee_usd) - num0(sell.gas_usd) };
    const buys = buyFillsByAsset.get(assetId) ?? [];
    let remaining = sells.qty;
    let matchedCost = 0;
    while (remaining > 1e-12 && buys.length) {
      const b = buys[0]!;
      const takeQty = Math.min(remaining, b.qty);
      matchedCost += (takeQty / b.qty) * b.cost;
      b.qty -= takeQty;
      remaining -= takeQty;
      if (b.qty <= 1e-12) buys.shift();
    }
    if (sells.qty > 0) {
      const pnl = sells.proceeds - matchedCost;
      realizedFromFills.push(pnl);
      roundTrips++;
      if (pnl > 0) roundTripWins++;
      else roundTripLosses++;
    }
  }
  const realizedPnl = realizedFromFills.reduce((a, x) => a + x, 0);
  // Prefer realized computed from round trips; if it disagrees with the stored portfolio realized, log is secondary.
  const winRate = roundTrips > 0 ? roundTripWins / roundTrips : null;

  return {
    id: DEFAULT_PORTFOLIO_ID,
    name: String(p?.name ?? "Default paper desk"),
    tradingMode: "PAPER",
    startingEquityUsd: start,
    cashUsd: cash,
    equityUsd: equity,
    realizedPnlUsd: realizedPnl,
    unrealizedPnlUsd: unreal,
    dayPnlUsd: dayPnl,
    dayPnlPct: start ? (dayPnl / start) * 100 : 0,
    maxDrawdownPct: num0(p?.max_drawdown_pct) * 100,
    peakEquityUsd: num0(p?.peak_equity_usd),
    positions,
    recentFills: fills.map((f) => ({
      id: String(f.id),
      orderId: String(f.order_id),
      assetId: String(f.asset_id),
      symbol: String(f.symbol ?? f.asset_id),
      side: f.side === "sell" ? "sell" : "buy",
      qty: num0(f.qty),
      price: num0(f.price),
      notionalUsd: num0(f.notional_usd),
      feeUsd: num0(f.fee_usd),
      slippageBps: num0(f.slippage_bps),
      gasUsd: num0(f.gas_usd),
      filledAt: String(f.filled_at),
      model: String(f.model),
    })),
    recentOrders: orders.map((o) => ({
      id: String(o.id),
      assetId: String(o.asset_id),
      symbol: String(o.symbol ?? o.asset_id),
      side: o.side === "sell" ? "sell" : "buy",
      status: String(o.status),
      requestedNotionalUsd: num0(o.requested_notional_usd),
      submittedAt: String(o.submitted_at),
      reason: o.reason ? String(o.reason) : null,
      latencyMs: o.latency_ms == null ? null : num0(o.latency_ms),
    })),
    equityCurve: snaps.map((s) => ({ t: String(s.observed_at), equity: num0(s.equity_usd) })),
    feesPaidUsd,
    slippagePaidUsd,
    nTrades: fills.length,
    nWins: roundTripWins,
    nLosses: roundTripLosses,
    winRate,
  };
}

function parseJsonArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  try {
    const p = JSON.parse(String(v ?? "[]")) as unknown;
    return Array.isArray(p) ? p.map(String) : [];
  } catch {
    return [];
  }
}

async function ingestOnce(): Promise<void> {
  await loadRuntimeSecrets();
  const sql = await getSql();
  try {
    await ensureLearnerVersion(sql);
  } catch {
    /* learning schema may not exist in older deployments */
  }
  const runId = rid();
  const t0 = Date.now();
  await sql.query(`insert into ingest_runs (id, started_at, status) values ($1, now(), 'running')`, [runId]);
  const errors: string[] = [];
  try {
    const [cg, global, trending, ds, pools, news, pm, fng, cb, xPosts, extras] = await Promise.all([
      fetchCoinGeckoMarkets(100),
      fetchCoinGeckoGlobal(),
      fetchTrending(),
      fetchDexScreenerDiscovery(),
      fetchNewPools(),
      fetchNews(),
      fetchPolymarket(),
      fetchFearGreed(),
      fetchCoinbaseSpot(),
      maybeFetchX(sql),
      fetchDeskExtras(),
    ]);

    const health: HealthPing[] = [
      cg.health, global.health, trending.health, ds.health, pools.health,
      ...news.health, pm.health, fng.health, cb.health, xPosts.health,
      ...extras.health,
    ].map((h) => ({ ...h, error: sanitizePublicError(h.error) }));
    await recordHealth(sql, health);
    const healthMap = new Map(health.map((h) => [h.source, h]));

    const merged = new Map<string, NormalizedAsset>();
    for (const a of [...cg.assets, ...ds.assets, ...pools.assets]) {
      const prev = merged.get(a.id);
      if (!prev) merged.set(a.id, a);
      else {
        merged.set(a.id, {
          ...prev,
          ...a,
          priceUsd: a.priceUsd ?? prev.priceUsd,
          liquidityUsd: Math.max(num0(a.liquidityUsd), num0(prev.liquidityUsd)) || a.liquidityUsd || prev.liquidityUsd,
          volume24hUsd: a.volume24hUsd ?? prev.volume24hUsd,
          sparkline7d: a.sparkline7d ?? prev.sparkline7d,
          coingeckoId: a.coingeckoId ?? prev.coingeckoId,
          imageUrl: a.imageUrl ?? prev.imageUrl,
        });
      }
    }
    const btc = merged.get("cg:bitcoin");
    if (btc && cb.btc) btc.priceUsd = cb.btc;
    const eth = merged.get("cg:ethereum");
    if (eth && cb.eth) eth.priceUsd = cb.eth;
    const sol = merged.get("cg:solana");
    if (sol && cb.sol) sol.priceUsd = cb.sol;

    const overlayBySym = new Map<string, { priceUsd: number; change24hPct: number | null }>();
    for (const o of extras.overlays) {
      overlayBySym.set(o.symbol.toUpperCase(), { priceUsd: o.priceUsd, change24hPct: o.change24hPct });
    }
    const overlayTs = nowIso();
    for (const a of merged.values()) {
      const ov = overlayBySym.get(a.symbol.toUpperCase());
      if (!ov) continue;
      if (ov.priceUsd > 0) {
        a.priceUsd = ov.priceUsd;
        a.observedAt = overlayTs;
        a.sourceTimestamp = overlayTs;
      }
      if (ov.change24hPct != null) a.change24hPct = ov.change24hPct;
    }

    for (const [id, a] of [...merged.entries()]) {
      if (!(a.priceUsd && a.priceUsd > 0) || !a.observedAt) {
        merged.delete(id);
        continue;
      }
      if (a.kind === "dex" && !a.contractAddress) merged.delete(id);
    }

    await upsertAssets(sql, [...merged.values()]);

    for (const pool of [...ds.pools, ...pools.pools]) {
      await sql.query(
        `insert into pools (id, asset_id, chain_id, address, dex, name, liquidity_usd, volume_24h_usd, volume_1h_usd, volume_5m_usd, txns_24h, buys_24h, sells_24h, price_usd, fdv_usd, created_at, observed_at, ingested_at, source)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now(),$18)
         on conflict (id) do update set
           liquidity_usd = excluded.liquidity_usd,
           volume_24h_usd = excluded.volume_24h_usd,
           volume_1h_usd = excluded.volume_1h_usd,
           observed_at = excluded.observed_at,
           ingested_at = now()`,
        [
          pool.id, pool.assetId, pool.chainId, pool.address, pool.dex, pool.name,
          pool.liquidityUsd, pool.volume24hUsd, pool.volume1hUsd, pool.volume5mUsd,
          pool.txns24h, pool.buys24h, pool.sells24h, pool.priceUsd, pool.fdvUsd,
          pool.createdAt, pool.observedAt, pool.source,
        ],
      );
    }

    const symbols = [...merged.values()].map((a) => a.symbol.toUpperCase()).filter((s) => s.length >= 3 && !STOP_WORDS.has(s));
    const uniqueSym = [...new Set(symbols)];

    for (const art of [...news.articles, ...extras.news]) {
      const entities = extractEntities(`${art.title} ${art.summary ?? ""}`, uniqueSym);
      await sql.query(
        `insert into news_articles (id, source, source_reliability, title, url, summary, entities, published_at, observed_at, ingested_at, freshness)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)
         on conflict (id) do update set freshness = excluded.freshness, ingested_at = now()`,
        [
          art.id.slice(0, 240), art.source, art.sourceReliability, art.title, art.url, art.summary,
          JSON.stringify(entities), art.publishedAt, art.ingestedAt, art.ingestedAt, art.freshness,
        ],
      );
    }

    for (const s of [...ds.social, ...xPosts.posts, ...extras.reddit]) {
      const entities = extractEntities(s.body, uniqueSym);
      await sql.query(
        `insert into social_posts (id, platform, author, url, body, engagement, source_reliability, entities, published_at, observed_at, ingested_at, freshness)
         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)
         on conflict (id) do nothing`,
        [
          s.id.slice(0, 240), s.platform, s.author, s.url, s.body, s.engagement, s.sourceReliability,
          JSON.stringify(entities), s.publishedAt, s.ingestedAt, s.ingestedAt, newsFreshness(s.publishedAt),
        ],
      );
    }

    for (const m of pm.markets) {
      await sql.query(
        `insert into polymarket_markets (id, event_id, slug, question, category, end_date, closed, volume, volume_24h, liquidity, probability, url, observed_at, ingested_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),now())
         on conflict (id) do update set
           probability_24h_ago = case when polymarket_markets.updated_at < now() - interval '20 hours' then polymarket_markets.probability else polymarket_markets.probability_24h_ago end,
           probability = excluded.probability,
           volume = excluded.volume,
           volume_24h = excluded.volume_24h,
           liquidity = excluded.liquidity,
           observed_at = excluded.observed_at,
           updated_at = now()`,
        [
          m.id, m.eventId, m.slug, m.question, m.category, m.endDate, m.closed,
          m.volume, m.volume24h, m.liquidity, m.probability, m.url, m.observedAt,
        ],
      );
    }

    const dexCandidates = [...merged.values()]
      .filter((a) => a.kind === "dex" && a.contractAddress && a.chainId)
      .sort((a, b) => num0(b.liquidityUsd) - num0(a.liquidityUsd))
      .slice(0, 5);
    const rugMap = new Map<string, { score: number; reasons: string[] }>();
    const secResults = await Promise.all(
      dexCandidates.map(async (a) => {
        try {
          return { a, sec: await fetchTokenSecurity(a.chainId!, a.contractAddress!) };
        } catch (e) {
          errors.push(`goplus ${a.id}: ${e instanceof Error ? e.message : "fail"}`);
          return null;
        }
      }),
    );
    for (const item of secResults) {
      if (!item) continue;
      if (item.sec.health.status !== "down") health.push(item.sec.health);
      if (item.sec.security) {
        const ageH = item.a.pairCreatedAt ? (Date.now() - new Date(item.a.pairCreatedAt).getTime()) / 3_600_000 : null;
        const assessed = assessRug(item.sec.security, { ageHours: ageH, liquidityUsd: item.a.liquidityUsd, name: item.a.name });
        rugMap.set(item.a.id, assessed);
        await sql.query(
          `insert into risk_events (id, asset_id, severity, kind, score, reasons, observed_at, ingested_at)
           values ($1,$2,$3,'rug_assessment',$4,$5::jsonb,now(),now())`,
          [rid(), item.a.id, assessed.score > 0.7 ? "high" : assessed.score > 0.4 ? "medium" : "low", assessed.score, JSON.stringify(assessed.reasons)],
        );
      }
    }

    const walletHits = new Map<string, number>();
    const tradePools = [...ds.pools, ...pools.pools].filter((p) => (p.liquidityUsd ?? 0) > 40_000).slice(0, 4);
    const tradeResults = await Promise.all(
      tradePools.map(async (p) => {
        const gtChain = Object.entries({ eth: "ethereum", bsc: "bsc", base: "base", arbitrum: "arbitrum", solana: "solana" }).find(([, v]) => v === p.chainId)?.[0];
        if (!gtChain || !p.address) return null;
        try {
          return { p, trades: await fetchPoolTrades(gtChain, p.address) };
        } catch (e) {
          errors.push(`trades ${p.id}: ${e instanceof Error ? e.message : "fail"}`);
          return null;
        }
      }),
    );
    for (const item of tradeResults) {
      if (!item) continue;
      for (const t of item.trades.slice(0, 20)) {
        if (!t.wallet) continue;
        const walletId = `${t.chainId}:${t.wallet.toLowerCase()}`;
        await sql.query(
          `insert into wallets (id, chain_id, address, classification, confidence, last_seen, first_seen)
           values ($1,$2,$3,'unknown',0.15,now(),now())
           on conflict (chain_id, address) do update set last_seen = now()`,
          [walletId, t.chainId, t.wallet],
        );
        await sql.query(
          `insert into wallet_transactions (id, wallet_id, chain_id, tx_hash, asset_id, side, price_usd, notional_usd, observed_at, ingested_at, source)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10)
           on conflict (id) do nothing`,
          [t.id, walletId, t.chainId, t.txHash, item.p.assetId, t.side, t.priceUsd, t.notionalUsd, t.observedAt, t.source],
        );
        if ((t.notionalUsd ?? 0) >= 1000) walletHits.set(item.p.assetId, (walletHits.get(item.p.assetId) ?? 0) + 1);
      }
    }

    const trendingSymbols = new Set(trending.items.map((t) => t.symbol.toUpperCase()));
    const newsRows = await sql.query<Record<string, unknown>>("select * from news_articles order by published_at desc nulls last limit 80");
    const socialRows = await sql.query<Record<string, unknown>>("select * from social_posts order by published_at desc nulls last limit 80");
    const pmRows = await sql.query<Record<string, unknown>>("select * from polymarket_markets order by volume_24h desc nulls last limit 60");

    const newsDto: NewsDTO[] = newsRows.map((r) => {
      const publishedAt = r.published_at ? String(r.published_at) : null;
      return {
        id: String(r.id),
        source: String(r.source),
        sourceReliability: num0(r.source_reliability),
        title: String(r.title),
        url: r.url ? String(r.url) : null,
        summary: r.summary ? String(r.summary) : null,
        entities: parseJsonArray(r.entities),
        publishedAt,
        ingestedAt: r.ingested_at ? String(r.ingested_at) : null,
        freshness: newsFreshness(publishedAt),
        ageMs: ageMs(publishedAt),
      };
    });
    const socialDto: SocialDTO[] = socialRows.map((r) => {
      const publishedAt = r.published_at ? String(r.published_at) : null;
      return {
        id: String(r.id),
        platform: String(r.platform),
        author: r.author ? String(r.author) : null,
        url: r.url ? String(r.url) : null,
        body: String(r.body ?? ""),
        engagement: r.engagement == null ? null : num0(r.engagement),
        entities: parseJsonArray(r.entities),
        publishedAt,
        freshness: newsFreshness(publishedAt),
        sourceReliability: num0(r.source_reliability),
        botLikelihood: r.bot_likelihood == null ? null : num0(r.bot_likelihood),
      };
    });
    const pmDto: PolymarketDTO[] = pmRows.map((r) => {
      const p0 = r.probability == null ? null : num0(r.probability);
      const p1 = r.probability_24h_ago == null ? null : num0(r.probability_24h_ago);
      return {
        id: String(r.id),
        question: String(r.question),
        slug: r.slug ? String(r.slug) : null,
        probability: p0,
        probabilityChange24h: p0 != null && p1 != null ? p0 - p1 : null,
        volume: r.volume == null ? null : num0(r.volume),
        volume24h: r.volume_24h == null ? null : num0(r.volume_24h),
        liquidity: r.liquidity == null ? null : num0(r.liquidity),
        endDate: r.end_date ? String(r.end_date) : null,
        url: r.url ? String(r.url) : null,
        category: r.category ? String(r.category) : null,
      };
    });

    const newsBoost = new Map<string, number>();
    for (const n of newsDto) {
      const w = (n.freshness === "NEW" ? 0.55 : n.freshness === "RECENT" ? 0.28 : 0.05) * n.sourceReliability;
      for (const e of n.entities) newsBoost.set(e, Math.max(newsBoost.get(e) ?? 0, w));
    }
    const socialBoost = new Map<string, number>();
    for (const s of socialDto) {
      for (const e of s.entities) socialBoost.set(e, Math.min(1, (socialBoost.get(e) ?? 0) + 0.12));
    }

    const ranked: RankedOpportunity[] = [];
    for (const x of merged.values()) {
      const a = rowAsset({
        ...x,
        chain_id: x.chainId,
        contract_address: x.contractAddress,
        coingecko_id: x.coingeckoId,
        image_url: x.imageUrl,
        price_usd: x.priceUsd,
        market_cap_usd: x.marketCapUsd,
        fdv_usd: x.fdvUsd,
        volume_24h_usd: x.volume24hUsd,
        liquidity_usd: x.liquidityUsd,
        change_1h_pct: x.change1hPct,
        change_24h_pct: x.change24hPct,
        change_7d_pct: x.change7dPct,
        pair_created_at: x.pairCreatedAt,
        sparkline_7d: x.sparkline7d,
        source_reliability: x.sourceReliability,
        observed_at: x.observedAt,
      });
      const rug = rugMap.get(a.id) ?? {
        score: a.kind === "dex" ? 0.28 : a.kind === "major" ? 0.08 : 0.2,
        reasons: a.kind === "dex"
          ? ["DEX token without completed security scan — residual uncertainty"]
          : ["Major / listed venue — residual market risk only"],
      };
      const scored = scoreOpportunity({
        asset: a,
        rugRisk: rug.score,
        riskReasons: rug.reasons,
        smartMoney: Math.min(1, (walletHits.get(a.id) ?? 0) * 0.18),
        social: Math.max(trendingSymbols.has(a.symbol) ? 0.55 : 0, socialBoost.get(a.symbol) ?? 0),
        news: newsBoost.get(a.symbol) ?? 0,
        sourceReliability: sourceReliabilityFor(a.source ?? "unknown", healthMap),
      }, SCORE_WEIGHTS);
      ranked.push(scored);
      await sql.query(
        `insert into opportunity_ranks (asset_id, score, components, reasons, rug_risk, confidence, updated_at)
         values ($1,$2,$3::jsonb,$4::jsonb,$5,$6,now())
         on conflict (asset_id) do update set score=excluded.score, components=excluded.components, reasons=excluded.reasons, rug_risk=excluded.rug_risk, confidence=excluded.confidence, updated_at=now()`,
        [a.id, scored.score, JSON.stringify(scored.components), JSON.stringify(scored.reasons), scored.rugRisk, scored.confidence],
      );
    }
    ranked.sort(compareOpportunities);

    const gen = generateSignals({
      ranked,
      news: newsDto,
      social: socialDto,
      polymarket: pmDto,
      trendingSymbols,
      walletHits,
      btcChange24h: ranked.find((r) => r.asset.id === "cg:bitcoin")?.asset.change24hPct ?? null,
    });
    let signalsCreated = 0;
    for (const s of gen) {
      const exists = await sql.query<{ id: string }>(
        `select id from signals where strategy_id=$1 and strategy_version=$2 and asset_id=$3 and status='open' and created_at > now() - interval '6 hours' limit 1`,
        [s.strategyId, s.strategyVersion, s.assetId],
      );
      if (exists[0]) continue;
      await sql.query(
        `insert into signals (id, strategy_id, strategy_version, asset_id, side, confidence, opportunity_score, status, entry_mid, expected_horizon, created_at, available_at, explanation)
         values ($1,$2,$3,$4,$5,$6,$7,'open',$8,$9,now(),now(),$10::jsonb)`,
        [rid(), s.strategyId, s.strategyVersion, s.assetId, s.side, s.confidence, s.opportunityScore, s.entryMid, s.expectedHorizon, JSON.stringify(s.explanation)],
      );
      signalsCreated += 1;
    }

    const sigRows = await sql.query<Record<string, unknown>>(
      `select s.*, a.symbol, a.name from signals s left join assets a on a.id = s.asset_id
       where s.status = 'open' order by s.created_at desc limit 40`,
    );
    const signalDto: SignalDTO[] = sigRows.map((r) => ({
      id: String(r.id),
      strategyId: String(r.strategy_id),
      strategyVersion: String(r.strategy_version),
      assetId: String(r.asset_id),
      symbol: String(r.symbol ?? r.asset_id),
      name: String(r.name ?? r.asset_id),
      side: r.side === "sell" ? "sell" : "buy",
      confidence: num0(r.confidence),
      opportunityScore: r.opportunity_score == null ? null : num0(r.opportunity_score),
      status: String(r.status),
      entryMid: r.entry_mid == null ? null : num0(r.entry_mid),
      expectedHorizon: r.expected_horizon ? String(r.expected_horizon) : null,
      createdAt: String(r.created_at),
      explanation: parseJsonArray(r.explanation),
    }));

    // ---- Event intelligence + Polymarket wallet intelligence ----
    const assetsForEvents = [...merged.values()].map((x) => rowAsset({ ...x, chain_id: x.chainId, contract_address: x.contractAddress, coingecko_id: x.coingeckoId, image_url: x.imageUrl, price_usd: x.priceUsd, market_cap_usd: x.marketCapUsd, fdv_usd: x.fdvUsd, volume_24h_usd: x.volume24hUsd, liquidity_usd: x.liquidityUsd, change_1h_pct: x.change1hPct, change_24h_pct: x.change24hPct, change_7d_pct: x.change7dPct, pair_created_at: x.pairCreatedAt, sparkline_7d: x.sparkline7d, source_reliability: x.sourceReliability, observed_at: x.observedAt }));
    const socialForEvents = socialDto.map((s) => ({ platform: s.platform, author: s.author, body: s.body }));
    let detectedEventDtos: DetectedEventDTO[] = [];
    let copySignalDtos: CopySignalDTO[] = [];
    try {
      const detectedEvents = detectEvents({ news: newsDto, social: socialForEvents, polymarket: pmDto, assets: assetsForEvents });
      detectedEventDtos = detectedEvents.map((e) => ({
        id: e.id,
        source: e.source,
        author: e.author,
        entityId: e.entityId,
        title: e.title,
        url: e.url,
        eventType: e.eventType,
        category: e.category,
        affectedAssets: e.affectedAssets,
        sentiment: e.sentiment,
        novelty: e.novelty,
        credibility: e.credibility,
        marketRelevance: e.marketRelevance,
        impactScore: e.impactScore,
        confidence: e.confidence,
        historicalContext: e.historicalContext,
        publishedAt: e.publishedAt,
        observedAt: e.observedAt,
      }));
      for (const e of detectedEvents.slice(0, 20)) {
        await sql.query(
          `insert into detected_events (id, source, source_reliability, author, entity_id, title, url, raw_text, event_type, category, affected_assets, sentiment, novelty, credibility, market_relevance, impact_score, confidence, historical_context, supporting_sources, contradictory_sources, published_at, observed_at, ingested_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20::jsonb,$21,$22,now())
           on conflict (id) do update set
             impact_score = excluded.impact_score,
             confidence = excluded.confidence,
             market_relevance = excluded.market_relevance,
             observed_at = excluded.observed_at,
             ingested_at = now()`,
          [e.id, e.source, e.sourceReliability, e.author, e.entityId, e.title, e.url, e.rawText, e.eventType, e.category, JSON.stringify(e.affectedAssets), e.sentiment, e.novelty, e.credibility, e.marketRelevance, e.impactScore, e.confidence, e.historicalContext, JSON.stringify(e.supportingSources), JSON.stringify(e.contradictorySources), e.publishedAt, e.observedAt],
        );
      }

      const { trades: pmTrades, health: pmDataHealth } = await fetchPolymarketGlobalTrades(250);
      if (pmDataHealth.status !== "down") health.push(pmDataHealth);
      const walletPerfMap = new Map<string, WalletPerformanceV2>();
      const walletTradesByWallet = new Map<string, PolymarketTrade[]>();
      for (const t of pmTrades) {
        const arr = walletTradesByWallet.get(t.walletId) ?? [];
        arr.push(t);
        walletTradesByWallet.set(t.walletId, arr);
      }
      const conditionIds = new Set(pmTrades.map((t) => t.conditionId).filter(Boolean));
      const marketPrices = new Map<string, number>();
      for (const m of pm.markets) {
        if (m.id && conditionIds.has(m.id.toLowerCase())) {
          marketPrices.set(m.id.toLowerCase(), num0(m.probability));
        }
      }
      for (const [walletId, trades] of walletTradesByWallet.entries()) {
        if (trades.length < 3) continue;
        const perf = evaluateWalletPerformance(trades, marketPrices);
        walletPerfMap.set(walletId, perf);
        for (const t of trades) {
          await sql.query(
            `insert into polymarket_wallet_trades (id, wallet_id, chain_id, address, tx_hash, market_id, condition_id, event_slug, market_title, outcome, side, size, price, notional_usd, timestamp, observed_at, source)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             on conflict (id) do nothing`,
            [t.id, walletId, t.chainId, t.address, t.txHash, t.marketId, t.conditionId, t.eventSlug, t.marketTitle, t.outcome, t.side, t.size, t.price, t.notionalUsd, t.timestamp, t.observedAt, t.source],
          );
        }
        await sql.query(
          `insert into wallet_performance_v2 (wallet_id, address, chain_id, n_trades, n_wins, n_losses, win_rate, avg_return_pct, median_return_pct, avg_win_pct, avg_loss_pct, payoff_ratio, profit_factor, realized_pnl_usd, max_drawdown_pct, avg_holding_hours, recent_n_trades, recent_return_pct, category_performance, quality_score, score_reasons, first_seen, last_seen, updated_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21::jsonb,$22,$23,now())
           on conflict (wallet_id) do update set
             n_trades = excluded.n_trades, n_wins = excluded.n_wins, n_losses = excluded.n_losses, win_rate = excluded.win_rate,
             avg_return_pct = excluded.avg_return_pct, median_return_pct = excluded.median_return_pct, avg_win_pct = excluded.avg_win_pct, avg_loss_pct = excluded.avg_loss_pct,
             payoff_ratio = excluded.payoff_ratio, profit_factor = excluded.profit_factor, realized_pnl_usd = excluded.realized_pnl_usd, max_drawdown_pct = excluded.max_drawdown_pct,
             avg_holding_hours = excluded.avg_holding_hours, recent_n_trades = excluded.recent_n_trades, recent_return_pct = excluded.recent_return_pct,
             category_performance = excluded.category_performance, quality_score = excluded.quality_score, score_reasons = excluded.score_reasons, first_seen = excluded.first_seen, last_seen = excluded.last_seen, updated_at = now()`,
          [perf.walletId, perf.address, perf.chainId, perf.nTrades, perf.nWins, perf.nLosses, perf.winRate, perf.avgReturnPct, perf.medianReturnPct, perf.avgWinPct, perf.avgLossPct, perf.payoffRatio, perf.profitFactor, perf.realizedPnlUsd, perf.maxDrawdownPct, perf.avgHoldingHours, perf.recentNTrades, perf.recentReturnPct, JSON.stringify(perf.categoryPerformance), perf.qualityScore, JSON.stringify(perf.scoreReasons), perf.firstSeen, perf.lastSeen],
        );
      }

      const assetMap = new Map<string, string>();
      for (const a of assetsForEvents) {
        if (a.coingeckoId) assetMap.set(a.coingeckoId, a.id);
      }
      const copySignals = generateCopySignals({ trades: pmTrades, wallets: walletPerfMap, markets: pmDto, assetMap });
      copySignalDtos = copySignals.slice(0, 20).map((s) => ({
        id: s.id, walletId: s.walletId, address: s.address, marketId: s.marketId, assetId: s.assetId, side: s.side,
        walletQualityScore: s.walletQualityScore, copyConfidence: s.copyConfidence, sourceTradeTimestamp: s.sourceTradeTimestamp,
        latencySeconds: s.latencySeconds, expectedValue: s.expectedValue, reasons: s.reasons,
      }));
      for (const s of copySignals.slice(0, 20)) {
        await sql.query(
          `insert into copy_signals (id, wallet_id, market_id, asset_id, side, wallet_quality_score, copy_confidence, source_trade_id, source_trade_timestamp, observed_at, latency_seconds, expected_value, status, reasons, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'open',$13::jsonb,now())
           on conflict (id) do update set copy_confidence = excluded.copy_confidence, expected_value = excluded.expected_value`,
          [s.id, s.walletId, s.marketId, s.assetId, s.side, s.walletQualityScore, s.copyConfidence, s.sourceTradeId, s.sourceTradeTimestamp, s.observedAt, s.latencySeconds, s.expectedValue, JSON.stringify(s.reasons)],
        );
      }
    } catch (addonErr) {
      errors.push(`events/wallets: ${addonErr instanceof Error ? addonErr.message : "failed"}`);
    }

    const btcA = ranked.find((r) => r.asset.id === "cg:bitcoin");
    const ethA = ranked.find((r) => r.asset.id === "cg:ethereum");
    const regimeLabel =
      (fng.value ?? 50) < 30 && (btcA?.asset.change24hPct ?? 0) < -3
        ? "Risk-off"
        : (fng.value ?? 50) > 70 && (btcA?.asset.change24hPct ?? 0) > 2
          ? "Risk-on / greedy"
          : "Mixed / transitional";
    const regime: RegimeInput = {
      fearGreed: fng.value,
      btcChange24h: btcA?.asset.change24hPct ?? null,
      ethChange24h: ethA?.asset.change24hPct ?? null,
      btcFundingPct: extras.fundingBtcPct,
      label: regimeLabel,
      dxyChangePct: extras.macro.dxyChangePct,
      spxChangePct: extras.macro.spxChangePct,
      mempoolFastSatVb: extras.mempoolFastSatVb,
    };
    await paperTick(sql, ranked, signalDto, regime);
    try {
      await runLearningJobs(sql);
    } catch (e) {
      errors.push(`learning jobs: ${e instanceof Error ? e.message : "fail"}`);
    }
    const portfolio = await assemblePortfolio(sql, ranked);
    const sources = await sql.query<Record<string, unknown>>("select * from source_health order by source");

    const live = evaluateLiveGates();
    cache.overview = {
      generatedAt: nowIso(),
      tradingMode: "PAPER",
      liveArmed: live.canSubmit,
      portfolio,
      regime: {
        fearGreed: fng.value,
        fearGreedLabel: fng.label,
        btcChange24h: btcA?.asset.change24hPct ?? null,
        ethChange24h: ethA?.asset.change24hPct ?? null,
        btcDominancePct: global.dominance,
        label: regimeLabel,
        btcFundingPct: extras.fundingBtcPct,
        ethFundingPct: extras.fundingEthPct,
        defiTvlUsd: extras.defiTvlUsd,
        stablecapUsd: extras.stablecapUsd,
        mempoolFastSatVb: extras.mempoolFastSatVb,
        hashrateEh: extras.hashrateEh,
        dxy: extras.macro.dxy,
        dxyChangePct: extras.macro.dxyChangePct,
        spx: extras.macro.spx,
        spxChangePct: extras.macro.spxChangePct,
        gold: extras.macro.gold,
        goldChangePct: extras.macro.goldChangePct,
        paprikaCapUsd: extras.paprikaCapUsd,
      },
      opportunities: ranked.slice(0, 40),
      signals: signalDto,
      news: newsDto.slice(0, 40),
      social: socialDto.slice(0, 40),
      polymarket: pmDto.slice(0, 40),
      detectedEvents: detectedEventDtos,
      copySignals: copySignalDtos,
      sources: sources.map((s) => ({
        source: String(s.source),
        status: (s.status as SourceHealth["status"]) ?? "down",
        latencyMs: s.latency_ms == null ? null : num0(s.latency_ms),
        lastSuccessAt: s.last_success_at ? String(s.last_success_at) : null,
        lastError: sanitizePublicError(s.last_error ? String(s.last_error) : null),
      })),
      lastIngestAt: nowIso(),
      ingestStatus: "ok",
      assetCount: merged.size,
      scanCapacity: { majors: cg.assets.length, dex: ds.assets.length + pools.assets.length, ranked: ranked.length },
      xUsage: xUsageDto(xPosts.budget),
    };
    cache.lastIngestAt = Date.now();
    if (cache.overview) await maybeStoreDigest(sql, cache.overview);
    await sql.query(
      `update ingest_runs set finished_at=now(), status='ok', assets_upserted=$2, signals_created=$3, errors=$4::jsonb, duration_ms=$5 where id=$1`,
      [runId, merged.size, signalsCreated, JSON.stringify(errors.map((e) => sanitizePublicError(e) ?? e)), Date.now() - t0],
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ingest failed";
    errors.push(msg);
    await sql.query(
      `update ingest_runs set finished_at=now(), status='error', errors=$2::jsonb, duration_ms=$3 where id=$1`,
      [runId, JSON.stringify(errors), Date.now() - t0],
    );
    throw e;
  }
}

export async function ensureIngested(force = false): Promise<OverviewDTO> {
  if (cache.overview && !cache.overview.xUsage) {
    cache.overview = null;
    cache.lastIngestAt = 0;
  }
  const fresh = Boolean(cache.overview && Date.now() - cache.lastIngestAt < INGEST_TTL_MS);
  if (!force && fresh && cache.overview) return cache.overview;

  // Stale-while-revalidate: never blank the desk after the first successful ingest.
  if (!force && cache.overview) {
    if (!cache.ingesting) {
      cache.ingesting = ingestOnce().finally(() => {
        cache.ingesting = null;
      });
    }
    return cache.overview;
  }

  if (cache.ingesting) {
    try {
      await cache.ingesting;
    } catch {
      /* continue */
    }
    if (cache.overview && !force) return cache.overview;
  }
  cache.ingesting = ingestOnce().finally(() => {
    cache.ingesting = null;
  });
  await cache.ingesting;
  if (!cache.overview) throw new Error("Ingest produced no snapshot");
  return cache.overview;
}

if (typeof window === "undefined") {
  startDeskScheduler(() => {
    void ensureIngested(false).catch((err) => {
      console.error("[aether] scheduled ingest failed:", err instanceof Error ? err.message : err);
    });
  });
  void startXMarketStream();
}

export async function getOverview(): Promise<OverviewDTO> {
  return ensureIngested(false);
}
export async function getOpportunities(): Promise<RankedOpportunity[]> {
  return (await ensureIngested(false)).opportunities;
}
export async function getScanner(): Promise<AssetRow[]> {
  await ensureIngested(false);
  const sql = await getSql();
  const rows = await sql.query<Record<string, unknown>>("select * from assets order by volume_24h_usd desc nulls last limit 400");
  return rows.map(rowAsset);
}
export async function getNews(): Promise<NewsDTO[]> {
  return (await ensureIngested(false)).news;
}
export async function getSocial(): Promise<{ posts: SocialDTO[]; xConfigured: boolean; xUsage: XUsageDTO }> {
  const o = await ensureIngested(false);
  return { posts: o.social, xConfigured: o.xUsage.configured, xUsage: o.xUsage };
}
export async function getPolymarket(): Promise<PolymarketDTO[]> {
  return (await ensureIngested(false)).polymarket;
}
export async function getDetectedEvents(): Promise<DetectedEventDTO[]> {
  return (await ensureIngested(false)).detectedEvents;
}
export async function getCopySignals(): Promise<CopySignalDTO[]> {
  return (await ensureIngested(false)).copySignals;
}
export async function getWallets(): Promise<{ wallets: WalletDTO[]; txs: WalletTxDTO[] }> {
  await ensureIngested(false);
  const sql = await getSql();
  const wallets = await sql.query<Record<string, unknown>>("select * from wallets order by last_seen desc nulls last limit 80");
  const txs = await sql.query<Record<string, unknown>>(
    `select t.*, w.address, w.label, w.classification from wallet_transactions t
     left join wallets w on w.id = t.wallet_id order by t.observed_at desc nulls last limit 80`,
  );
  return {
    wallets: wallets.map((w) => ({
      id: String(w.id),
      chainId: String(w.chain_id),
      address: String(w.address),
      label: w.label ? String(w.label) : null,
      classification: String(w.classification ?? "unknown"),
      confidence: num0(w.confidence),
      nTrades: 0,
      lastSeen: w.last_seen ? String(w.last_seen) : null,
      notes: w.notes ? String(w.notes) : "Observed in recent pool prints. Classification is unknown until a track record exists.",
    })),
    txs: txs.map((t) => ({
      id: String(t.id),
      walletId: t.wallet_id ? String(t.wallet_id) : null,
      address: t.address ? String(t.address) : undefined,
      label: t.label ? String(t.label) : null,
      chainId: t.chain_id ? String(t.chain_id) : null,
      txHash: t.tx_hash ? String(t.tx_hash) : null,
      assetId: t.asset_id ? String(t.asset_id) : null,
      side: t.side ? String(t.side) : null,
      notionalUsd: t.notional_usd == null ? null : num0(t.notional_usd),
      priceUsd: t.price_usd == null ? null : num0(t.price_usd),
      observedAt: t.observed_at ? String(t.observed_at) : null,
    })),
  };
}
export async function getPaper(): Promise<PortfolioDTO> {
  return (await ensureIngested(false)).portfolio;
}
export async function getLearningDashboardData(): Promise<LearnerDashboard> {
  // The dashboard reads the already-persisted learner state; it does not need
  // to block on a fresh ingest cycle.
  return getLearnerDashboard();
}

export async function getLearnerModeData(): Promise<{ mode: LearnerOperatingMode; updatedAt: string | null }> {
  const sql = await getSql();
  return getLearnerOperatingState(sql);
}

export async function changeLearnerModeData(input: {
  mode: LearnerOperatingMode;
  password: string;
}): Promise<{ ok: boolean; mode: LearnerOperatingMode; error?: string }> {
  const sql = await getSql();
  const result = await setLearnerOperatingState(sql, {
    requestedMode: input.mode,
    password: input.password,
    clientContext: { source: "web_dashboard" },
  });
  return { ok: result.ok, mode: result.mode, error: result.error };
}
export async function getXIntelligenceDashboard() {
  return getXIntelligence();
}

export async function getSystem(): Promise<SystemDTO> {
  const o = await ensureIngested(false);
  const sql = await getSql();
  const run = (await sql.query<Record<string, unknown>>("select * from ingest_runs order by started_at desc limit 1"))[0];
  const alerts = await sql.query<Record<string, unknown>>("select id, kind, severity, title, created_at from alerts order by created_at desc limit 30");
  const live = evaluateLiveGates();
  const meta = await loadLatestDigestMeta();
  return {
    tradingMode: "PAPER",
    liveGates: live.gates,
    sources: o.sources,
    lastIngest: {
      startedAt: run?.started_at ? String(run.started_at) : null,
      finishedAt: run?.finished_at ? String(run.finished_at) : null,
      status: run?.status ? String(run.status) : null,
      durationMs: run?.duration_ms == null ? null : num0(run.duration_ms),
      assetsUpserted: run?.assets_upserted == null ? null : num0(run.assets_upserted),
      signalsCreated: run?.signals_created == null ? null : num0(run.signals_created),
      errors: parseJsonArray(run?.errors).map((e) => sanitizePublicError(e) ?? e),
    },
    dbSource,
    paperStartingEquity: o.portfolio.startingEquityUsd,
    alerts: alerts.map((a) => ({
      id: String(a.id), kind: String(a.kind), severity: String(a.severity), title: String(a.title), createdAt: String(a.created_at),
    })),
    xUsage: o.xUsage,
    pollMs: INGEST_POLL_MS,
    lastDigestAt: meta.generatedAt,
    digestSchedule: "08:00 and 20:00 Europe/London — emailed privately, never shown on this public desk",
  };
}
export async function getStrategies() {
  const sql = await getSql();
  const rows = await sql.query<Record<string, unknown>>("select * from strategies order by name");
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    version: String(r.version),
    description: r.description ? String(r.description) : null,
    enabled: Boolean(r.enabled),
    params: (typeof r.params === "object" && r.params ? r.params : {}) as Record<string, number | string | boolean>,
  }));
}
export async function getToken(id: string) {
  await ensureIngested(false);
  const sql = await getSql();
  const row = (await sql.query<Record<string, unknown>>("select * from assets where id = $1", [id]))[0];
  if (!row) return null;
  const asset = rowAsset(row);
  const rank = (await sql.query<Record<string, unknown>>("select * from opportunity_ranks where asset_id = $1", [id]))[0];
  const risks = await sql.query<Record<string, unknown>>("select * from risk_events where asset_id = $1 order by observed_at desc limit 8", [id]);
  const sigs = await sql.query<Record<string, unknown>>("select * from signals where asset_id = $1 order by created_at desc limit 10", [id]);
  const reports = await sql.query<Record<string, unknown>>("select * from research_reports where asset_id = $1 order by created_at desc limit 3", [id]);
  return {
    asset,
    score: rank ? num0(rank.score) : null,
    confidence: rank ? num0(rank.confidence) : null,
    rugRisk: rank ? num0(rank.rug_risk) : null,
    reasons: parseJsonArray(rank?.reasons),
    components: rank?.components ?? null,
    risks: risks.map((r) => ({
      kind: String(r.kind),
      severity: String(r.severity),
      score: num0(r.score),
      reasons: parseJsonArray(r.reasons),
      observedAt: String(r.observed_at),
    })),
    signals: sigs.map((s) => ({
      id: String(s.id), strategyId: String(s.strategy_id), confidence: num0(s.confidence), createdAt: String(s.created_at),
    })),
    reports: reports.map((r) => ({
      id: String(r.id), fact: String(r.fact ?? ""), inference: String(r.inference ?? ""),
      uncertainty: String(r.uncertainty ?? ""), speculation: String(r.speculation ?? ""), createdAt: String(r.created_at),
    })),
  };
}
export async function runTokenResearch(assetId: string): Promise<ResearchDTO | { error: string }> {
  const tok = await getToken(assetId);
  if (!tok) return { error: "Unknown asset" };
  const ctx = [
    `Asset ${tok.asset.symbol} (${tok.asset.name}) id=${tok.asset.id}`,
    `Price ${tok.asset.priceUsd} USD, liq ${tok.asset.liquidityUsd}, vol24h ${tok.asset.volume24hUsd}`,
    `Δ1h ${tok.asset.change1hPct} Δ24h ${tok.asset.change24hPct} Δ7d ${tok.asset.change7dPct}`,
    `Kind ${tok.asset.kind} chain ${tok.asset.chainId} contract ${tok.asset.contractAddress}`,
    `Observed ${tok.asset.observedAt} age ${formatAge(tok.asset.dataAgeMs)}`,
    `Score ${tok.score} confidence ${tok.confidence} rugRisk ${tok.rugRisk}`,
    `Reasons: ${(tok.reasons ?? []).join("; ")}`,
    `Risks: ${tok.risks.map((r) => `${r.kind} ${r.score}`).join("; ")}`,
  ].join("\n");
  const result = await runResearch(ctx);
  if (!result.ok) return { error: result.error };
  const sql = await getSql();
  const id = rid();
  await sql.query(
    `insert into research_reports (id, asset_id, model, fact, inference, uncertainty, speculation, raw, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,now())`,
    [id, assetId, result.draft.model, result.draft.fact, result.draft.inference, result.draft.uncertainty, result.draft.speculation, result.draft.raw],
  );
  return {
    id, assetId, model: result.draft.model, fact: result.draft.fact, inference: result.draft.inference,
    uncertainty: result.draft.uncertainty, speculation: result.draft.speculation, createdAt: nowIso(),
  };
}
export async function runBacktestJob(pair: "XBTUSD" | "ETHUSD" = "XBTUSD"): Promise<BacktestDTO> {
  const { candles, health, assetId } = await fetchKrakenOhlc(pair, 1440);
  const sql = await getSql();
  await recordHealth(sql, [health]);
  const mapped: Candle[] = candles.map((c) => ({ t: c.t, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
  const { inSample, outOfSample } = walkForwardSplit(mapped, 0.7);
  const benchmark = { buyHoldReturnPct: runBuyHoldBenchmark(mapped) };
  const isRes = runMomentumBacktest(inSample, DEFAULT_MOMENTUM, 10_000, benchmark);
  const oos = runMomentumBacktest(outOfSample, DEFAULT_MOMENTUM, 10_000, benchmark);
  const full = runMomentumBacktest(mapped, DEFAULT_MOMENTUM, 10_000, benchmark);
  const id = rid();
  const dto: BacktestDTO = {
    id, strategyId: "momentum_v1", strategyVersion: "1.0.0", assetId, venue: "kraken", timeframe: "1d",
    startTime: mapped[0] ? new Date(mapped[0].t).toISOString() : null,
    endTime: mapped.length ? new Date(mapped[mapped.length - 1]!.t).toISOString() : null,
    inSample: false, walkForward: true, metrics: oos.metrics, equityCurve: full.equityCurve,
    notes: `In-sample return ${isRes.metrics.totalReturnPct.toFixed(1)}% vs out-of-sample ${oos.metrics.totalReturnPct.toFixed(1)}%. ${oos.notes} Full-sample shown on the curve for inspection — do not select on it.`,
    createdAt: nowIso(),
  };
  await sql.query(
    `insert into backtest_runs (id, strategy_id, strategy_version, params, venue, asset_id, timeframe, start_time, end_time, in_sample, walk_forward, metrics, equity_curve, trades, notes, created_at)
     values ($1,'momentum_v1','1.0.0',$2::jsonb,'kraken',$3,'1d',$4,$5,false,true,$6::jsonb,$7::jsonb,$8::jsonb,$9,now())`,
    [id, JSON.stringify({ pair, lookback: 5 }), assetId, dto.startTime, dto.endTime, JSON.stringify(dto.metrics), JSON.stringify(dto.equityCurve), JSON.stringify(oos.trades.slice(0, 80)), dto.notes],
  );
  return dto;
}
export async function listBacktests(): Promise<BacktestDTO[]> {
  const sql = await getSql();
  const rows = await sql.query<Record<string, unknown>>("select * from backtest_runs order by created_at desc limit 12");
  return rows.map((r) => ({
    id: String(r.id), strategyId: String(r.strategy_id), strategyVersion: String(r.strategy_version),
    assetId: String(r.asset_id ?? ""), venue: String(r.venue ?? ""), timeframe: String(r.timeframe ?? ""),
    startTime: r.start_time ? String(r.start_time) : null, endTime: r.end_time ? String(r.end_time) : null,
    inSample: Boolean(r.in_sample), walkForward: Boolean(r.walk_forward),
    metrics: r.metrics as BacktestDTO["metrics"],
    equityCurve: (Array.isArray(r.equity_curve) ? r.equity_curve : []) as BacktestDTO["equityCurve"],
    notes: r.notes ? String(r.notes) : null, createdAt: String(r.created_at),
  }));
}
export async function placeManualPaperTrade(input: { assetId: string; side: "buy" | "sell"; notionalUsd: number }) {
  const o = await ensureIngested(false);
  const sql = await getSql();
  const asset = o.opportunities.find((x) => x.asset.id === input.assetId)?.asset ?? (await getToken(input.assetId))?.asset;
  if (!asset?.priceUsd) return { ok: false as const, error: "No mark price" };
  const age = asset.dataAgeMs;
  if (age != null && Number.isFinite(age) && age > PRICE_TRADE_STALE_MS) {
    return { ok: false as const, error: "Mark is stale — wait for the next live ingest" };
  }
  const fill = simulateFill({
    side: input.side, mid: asset.priceUsd, notionalUsd: input.notionalUsd,
    liquidityUsd: asset.liquidityUsd ?? 0, volatilityPct: Math.abs(asset.change24hPct ?? 8),
    latencyMs: pickLatencyMs(`manual:${input.assetId}`), gasUsd: gasForChain(asset.chainId),
    seed: `manual:${input.assetId}:${input.side}`,
  });
  const oid = rid();
  await sql.query(
    `insert into paper_orders (id, portfolio_id, asset_id, side, type, status, requested_notional_usd, submitted_at, available_at, reason, latency_ms, assumed_mid)
     values ($1,$2,$3,$4,'market',$5,$6,now(),now(),'manual',$7,$8)`,
    [oid, DEFAULT_PORTFOLIO_ID, input.assetId, input.side, fill.ok ? "filled" : "rejected", input.notionalUsd, fill.latencyMs, asset.priceUsd],
  );
  if (!fill.ok) return { ok: false as const, error: fill.rejectReason ?? "rejected" };
  await sql.query(
    `insert into paper_fills (id, order_id, portfolio_id, asset_id, side, qty, price, notional_usd, fee_usd, slippage_bps, gas_usd, filled_at, model)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),$12)`,
    [rid(), oid, DEFAULT_PORTFOLIO_ID, input.assetId, input.side, fill.qty, fill.price, fill.notionalUsd, fill.feeUsd, fill.slippageBps, fill.gasUsd, fill.model],
  );
  cache.overview = null;
  cache.lastIngestAt = 0;
  return { ok: true as const, fill };
}

export { formatAge };

async function maybeStoreDigest(sql: Sql, overview: OverviewDTO): Promise<void> {
  const hit = londonSlot();
  if (!hit) return;
  const key = digestKey(hit.slot, hit.date);
  if (await wasDigestSent(key)) return;
  const report = buildDigest(overview, hit.slot);
  await rememberDigest(key, report);
  try {
    await sql.query(
      `insert into digest_reports (id, slot, generated_at, subject, body_text, created_at)
       values ($1,$2,now(),$3,$4,now())
       on conflict (id) do nothing`,
      [key, hit.slot, report.subject, report.text],
    );
  } catch {
    /* table arrives with 0003 */
  }
  overview.lastDigestAt = report.generatedAt;
  overview.nextDigestSlot = hit.slot === "morning" ? "20:00 Europe/London" : "08:00 Europe/London";
}
