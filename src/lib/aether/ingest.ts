import { getSql, dbSource, type Sql } from "@/lib/db";
import {
  DEFAULT_PORTFOLIO_ID,
  INGEST_POLL_MS,
  INGEST_TTL_MS,
  PAPER_FEES,
  PRICE_TRADE_STALE_MS,
  RISK_LIMITS,
  SCORE_WEIGHTS,
  envFlag,
  envStr,
} from "./config";
import { assessRug, checkOrderRisk } from "./risk";
import { scoreOpportunity, compareOpportunities } from "./scoring";
import { generateSignals } from "./signals";
import { gasForChain, pickLatencyMs, positionSizeUsd, simulateFill } from "./paper";
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
import { ageMs, formatAge, newsFreshness, nowIso } from "./time";
import { num0 } from "./math";
import type {
  AssetRow,
  BacktestDTO,
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
import { runMomentumBacktest, walkForwardSplit, type Candle } from "./backtest";
import { runResearch } from "./research";
import { loadRuntimeSecrets } from "./secrets";
import { startDeskScheduler } from "./scheduler";
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
    lastError: budget.lastError,
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

function isQualityPaperEntry(r: RankedOpportunity, s: SignalDTO): boolean {
  if (s.strategyId === "social_proxy_v1") return false;
  if (s.confidence < 0.64) return false;
  if ((r.asset.dataAgeMs ?? Number.POSITIVE_INFINITY) > PRICE_TRADE_STALE_MS) return false;
  if (!(r.asset.priceUsd && r.asset.priceUsd > 0)) return false;
  if (r.rugRisk >= 0.45) return false;
  if (Math.abs(r.asset.change24hPct ?? 0) > 80) return false;
  const liq = r.asset.liquidityUsd ?? 0;
  if (r.asset.kind === "dex") return liq >= 250_000;
  return liq >= 400_000;
}

const STOP_WORDS = new Set([
  "THE", "AND", "FOR", "ARE", "YOU", "NEW", "ALL", "BUT", "NOT", "ANY", "CAN", "OUR", "OUT",
  "NOW", "TOP", "LOW", "GAS", "FEE", "PER", "DAY", "USD", "NFT", "DAO", "CEO", "ETF",
]);

function rid(): string {
  return crypto.randomUUID();
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
        h.error,
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

async function cfgBool(sql: Sql, key: string, fallback: boolean): Promise<boolean> {
  const rows = await sql.query<{ value: unknown }>("select value from system_config where key = $1", [key]);
  const v = rows[0]?.value;
  if (typeof v === "boolean") return v;
  if (v === "true" || v === true) return true;
  if (v === "false" || v === false) return false;
  return fallback;
}

async function loadKill(sql: Sql): Promise<boolean> {
  if (envFlag("KILL_SWITCH", false)) return true;
  return cfgBool(sql, "kill_switch", false);
}

export async function setKillSwitch(on: boolean): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `insert into system_config (key, value, updated_at) values ('kill_switch', $1::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [JSON.stringify(on)],
  );
  cache.overview = null;
}

async function paperTick(sql: Sql, ranked: RankedOpportunity[], signals: SignalDTO[], kill: boolean) {
  const pRows = await sql.query<Record<string, unknown>>("select * from paper_portfolios where id = $1", [DEFAULT_PORTFOLIO_ID]);
  const p = pRows[0];
  if (!p) return;
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

  for (const pos of posRows) {
    const assetId = String(pos.asset_id);
    const qty = num0(pos.qty);
    const avg = num0(pos.avg_price);
    const mark = marks.get(assetId) ?? avg;
    if (!(qty > 0) || !(mark > 0)) continue;
    const pnlPct = (mark - avg) / avg;
    const opened = pos.opened_at ? new Date(String(pos.opened_at)).getTime() : Date.now();
    const ageH = (Date.now() - opened) / 3_600_000;
    const shouldExit = pnlPct <= -0.08 || pnlPct >= 0.18 || ageH >= 36;
    if (!shouldExit) continue;
    const asset = ranked.find((r) => r.asset.id === assetId)?.asset;
    const fill = simulateFill({
      side: "sell",
      mid: mark,
      notionalUsd: qty * mark,
      liquidityUsd: asset?.liquidityUsd ?? 1_000_000,
      volatilityPct: Math.abs(asset?.change24hPct ?? 5),
      latencyMs: pickLatencyMs(`exit:${assetId}`),
      gasUsd: gasForChain(asset?.chainId),
      seed: `exit:${assetId}:${Date.now()}`,
    });
    if (!fill.ok) continue;
    const proceeds = fill.qty * fill.price - fill.feeUsd - fill.gasUsd;
    const pnl = proceeds - qty * avg;
    cash += proceeds;
    realized += pnl;
    const oid = rid();
    await sql.query(
      `insert into paper_orders (id, portfolio_id, asset_id, side, type, status, requested_notional_usd, submitted_at, available_at, reason, latency_ms, assumed_mid)
       values ($1,$2,$3,'sell','market','filled',$4,now(),now(),$5,$6,$7)`,
      [oid, DEFAULT_PORTFOLIO_ID, assetId, qty * mark, "exit-rule", fill.latencyMs, mark],
    );
    await sql.query(
      `insert into paper_fills (id, order_id, portfolio_id, asset_id, side, qty, price, notional_usd, fee_usd, slippage_bps, gas_usd, filled_at, model)
       values ($1,$2,$3,$4,'sell',$5,$6,$7,$8,$9,$10,now(),$11)`,
      [rid(), oid, DEFAULT_PORTFOLIO_ID, assetId, fill.qty, fill.price, fill.notionalUsd, fill.feeUsd, fill.slippageBps, fill.gasUsd, fill.model],
    );
    await sql.query("delete from positions where id = $1", [pos.id]);
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

  if (!kill) {
    const candidates = signals
      .filter((s) => s.side === "buy" && s.status === "open" && !held.has(s.assetId))
      .filter((s) => {
        const r = ranked.find((x) => x.asset.id === s.assetId);
        return r ? isQualityPaperEntry(r, s) : false;
      })
      .slice(0, 2);
    for (const s of candidates) {
      const r = ranked.find((x) => x.asset.id === s.assetId);
      if (!r || !r.asset.priceUsd) continue;
      if (!isQualityPaperEntry(r, s)) continue;
      const size = positionSizeUsd(
        equity,
        s.confidence,
        RISK_LIMITS.maxPositionPct,
        r.asset.liquidityUsd ?? 0,
        RISK_LIMITS.maxLiquidityTakePct,
      );
      if (size < 25) continue;
      const slipBps = PAPER_FEES.baseSlippageBps + (size / Math.max(r.asset.liquidityUsd ?? 1, 1)) * 8500;
      const chainNotional = openPos
        .filter((p0) => ranked.find((x) => x.asset.id === p0.asset_id)?.asset.chainId === r.asset.chainId)
        .reduce((a, p0) => a + p0.qty * (marks.get(p0.asset_id) ?? p0.avg_price), 0);
      const gate = checkOrderRisk({
        killSwitch: kill,
        equity,
        cash,
        requestedNotional: size,
        dayPnlUsd: equity - dayAnchor,
        tokenNotionalAfter: size,
        chainNotionalAfter: chainNotional + size,
        liquidityUsd: r.asset.liquidityUsd ?? 0,
        slippageBps: slipBps,
        limits: RISK_LIMITS,
      });
      const latency = pickLatencyMs(s.id);
      const oid = rid();
      if (!gate.ok) {
        await sql.query(
          `insert into paper_orders (id, portfolio_id, signal_id, asset_id, side, type, status, requested_notional_usd, submitted_at, available_at, reason, latency_ms, assumed_mid)
           values ($1,$2,$3,$4,'buy','market','rejected',$5,now(),now(),$6,$7,$8)`,
          [oid, DEFAULT_PORTFOLIO_ID, s.id, s.assetId, size, gate.reasons.join("; "), latency, r.asset.priceUsd],
        );
        continue;
      }
      const fill = simulateFill({
        side: "buy",
        mid: r.asset.priceUsd,
        notionalUsd: size,
        liquidityUsd: r.asset.liquidityUsd ?? 0,
        volatilityPct: Math.abs(r.asset.change24hPct ?? 8),
        latencyMs: latency,
        gasUsd: gasForChain(r.asset.chainId),
        seed: `buy:${s.id}`,
      });
      if (!fill.ok) {
        await sql.query(
          `insert into paper_orders (id, portfolio_id, signal_id, asset_id, side, type, status, requested_notional_usd, submitted_at, available_at, reason, latency_ms, assumed_mid)
           values ($1,$2,$3,$4,'buy','market','rejected',$5,now(),now(),$6,$7,$8)`,
          [oid, DEFAULT_PORTFOLIO_ID, s.id, s.assetId, size, fill.rejectReason, latency, r.asset.priceUsd],
        );
        continue;
      }
      const cost = fill.notionalUsd + fill.feeUsd + fill.gasUsd;
      if (cost > cash) continue;
      cash -= cost;
      await sql.query(
        `insert into paper_orders (id, portfolio_id, signal_id, asset_id, side, type, status, requested_notional_usd, submitted_at, available_at, reason, latency_ms, assumed_mid)
         values ($1,$2,$3,$4,'buy','market','filled',$5,now(),now(),$6,$7,$8)`,
        [oid, DEFAULT_PORTFOLIO_ID, s.id, s.assetId, size, "signal-entry", latency, r.asset.priceUsd],
      );
      await sql.query(
        `insert into paper_fills (id, order_id, portfolio_id, asset_id, side, qty, price, notional_usd, fee_usd, slippage_bps, gas_usd, filled_at, model)
         values ($1,$2,$3,$4,'buy',$5,$6,$7,$8,$9,$10,now(),$11)`,
        [rid(), oid, DEFAULT_PORTFOLIO_ID, s.assetId, fill.qty, fill.price, fill.notionalUsd, fill.feeUsd, fill.slippageBps, fill.gasUsd, fill.model],
      );
      await sql.query(
        `insert into positions (id, portfolio_id, asset_id, qty, avg_price, opened_at, updated_at)
         values ($1,$2,$3,$4,$5,now(),now())
         on conflict (portfolio_id, asset_id) do update set
           qty = positions.qty + excluded.qty,
           avg_price = (positions.avg_price * positions.qty + excluded.avg_price * excluded.qty) / nullif(positions.qty + excluded.qty, 0),
           updated_at = now()`,
        [rid(), DEFAULT_PORTFOLIO_ID, s.assetId, fill.qty, fill.price],
      );
      held.add(s.assetId);
      await sql.query(
        `insert into alerts (id, kind, severity, title, body, asset_id, created_at, channel)
         values ($1,'paper_trade','info',$2,$3,$4,now(),'in-app')`,
        [rid(), `Paper ${s.side} ${r.asset.symbol}`, `Filled ${fill.qty} @ ${fill.price} (slip ${fill.slippageBps} bps)`, s.assetId],
      );
    }
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
  const kill = await loadKill(sql);
  const cash = num0(p?.cash_usd);
  const unreal = positions.reduce((a, x) => a + x.unrealizedPnlUsd, 0);
  const equity = cash + positions.reduce((a, x) => a + x.notionalUsd, 0);
  const start = num0(p?.starting_equity_usd) || 10_000;
  const dayPnl = num0(p?.day_pnl_usd);
  return {
    id: DEFAULT_PORTFOLIO_ID,
    name: String(p?.name ?? "Default paper desk"),
    tradingMode: "PAPER",
    killSwitch: kill,
    startingEquityUsd: start,
    cashUsd: cash,
    equityUsd: equity,
    realizedPnlUsd: num0(p?.realized_pnl_usd),
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
    winRate: null,
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
  const runId = rid();
  const t0 = Date.now();
  await sql.query(`insert into ingest_runs (id, started_at, status) values ($1, now(), 'running')`, [runId]);
  const errors: string[] = [];
  try {
    const [cg, global, trending, ds, pools, news, pm, fng, cb, xPosts] = await Promise.all([
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
    ]);

    const health: HealthPing[] = [
      cg.health, global.health, trending.health, ds.health, pools.health,
      ...news.health, pm.health, fng.health, cb.health, xPosts.health,
    ];
    await recordHealth(sql, health);

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

    for (const art of news.articles) {
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

    for (const s of [...ds.social, ...xPosts.posts]) {
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

    const gen = generateSignals({ ranked, news: newsDto, social: socialDto, polymarket: pmDto, trendingSymbols, walletHits });
    let signalsCreated = 0;
    for (const s of gen) {
      const exists = await sql.query<{ id: string }>(
        `select id from signals where strategy_id=$1 and asset_id=$2 and status='open' and created_at > now() - interval '6 hours' limit 1`,
        [s.strategyId, s.assetId],
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

    const kill = await loadKill(sql);
    await paperTick(sql, ranked, signalDto, kill);
    const portfolio = await assemblePortfolio(sql, ranked);
    const sources = await sql.query<Record<string, unknown>>("select * from source_health order by source");
    const btcA = ranked.find((r) => r.asset.id === "cg:bitcoin");
    const ethA = ranked.find((r) => r.asset.id === "cg:ethereum");
    const regimeLabel =
      (fng.value ?? 50) < 30 && (btcA?.asset.change24hPct ?? 0) < -3
        ? "Risk-off"
        : (fng.value ?? 50) > 70 && (btcA?.asset.change24hPct ?? 0) > 2
          ? "Risk-on / greedy"
          : "Mixed / transitional";

    const live = evaluateLiveGates();
    cache.overview = {
      generatedAt: nowIso(),
      tradingMode: "PAPER",
      liveArmed: live.canSubmit,
      killSwitch: kill,
      portfolio,
      regime: {
        fearGreed: fng.value,
        fearGreedLabel: fng.label,
        btcChange24h: btcA?.asset.change24hPct ?? null,
        ethChange24h: ethA?.asset.change24hPct ?? null,
        btcDominancePct: global.dominance,
        label: regimeLabel,
      },
      opportunities: ranked.slice(0, 40),
      signals: signalDto,
      news: newsDto.slice(0, 40),
      social: socialDto.slice(0, 40),
      polymarket: pmDto.slice(0, 40),
      sources: sources.map((s) => ({
        source: String(s.source),
        status: (s.status as SourceHealth["status"]) ?? "down",
        latencyMs: s.latency_ms == null ? null : num0(s.latency_ms),
        lastSuccessAt: s.last_success_at ? String(s.last_success_at) : null,
        lastError: s.last_error ? String(s.last_error) : null,
      })),
      lastIngestAt: nowIso(),
      ingestStatus: "ok",
      assetCount: merged.size,
      scanCapacity: { majors: cg.assets.length, dex: ds.assets.length + pools.assets.length, ranked: ranked.length },
      xUsage: xUsageDto(xPosts.budget),
    };
    cache.lastIngestAt = Date.now();
    await sql.query(
      `update ingest_runs set finished_at=now(), status='ok', assets_upserted=$2, signals_created=$3, errors=$4::jsonb, duration_ms=$5 where id=$1`,
      [runId, merged.size, signalsCreated, JSON.stringify(errors), Date.now() - t0],
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
export async function getSystem(): Promise<SystemDTO> {
  const o = await ensureIngested(false);
  const sql = await getSql();
  const run = (await sql.query<Record<string, unknown>>("select * from ingest_runs order by started_at desc limit 1"))[0];
  const alerts = await sql.query<Record<string, unknown>>("select id, kind, severity, title, created_at from alerts order by created_at desc limit 30");
  const live = evaluateLiveGates();
  return {
    tradingMode: "PAPER",
    liveGates: live.gates,
    killSwitch: o.killSwitch,
    sources: o.sources,
    lastIngest: {
      startedAt: run?.started_at ? String(run.started_at) : null,
      finishedAt: run?.finished_at ? String(run.finished_at) : null,
      status: run?.status ? String(run.status) : null,
      durationMs: run?.duration_ms == null ? null : num0(run.duration_ms),
      assetsUpserted: run?.assets_upserted == null ? null : num0(run.assets_upserted),
      signalsCreated: run?.signals_created == null ? null : num0(run.signals_created),
      errors: parseJsonArray(run?.errors),
    },
    dbSource,
    paperStartingEquity: o.portfolio.startingEquityUsd,
    alerts: alerts.map((a) => ({
      id: String(a.id), kind: String(a.kind), severity: String(a.severity), title: String(a.title), createdAt: String(a.created_at),
    })),
    xUsage: o.xUsage,
    pollMs: INGEST_POLL_MS,
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
  const isRes = runMomentumBacktest(inSample);
  const oos = runMomentumBacktest(outOfSample);
  const full = runMomentumBacktest(mapped);
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
  if (await loadKill(sql)) return { ok: false as const, error: "Kill switch is engaged" };
  const asset = o.opportunities.find((x) => x.asset.id === input.assetId)?.asset ?? (await getToken(input.assetId))?.asset;
  if (!asset?.priceUsd) return { ok: false as const, error: "No mark price" };
  if ((asset.dataAgeMs ?? Number.POSITIVE_INFINITY) > PRICE_TRADE_STALE_MS) {
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
