import { fetchJson } from "./http.ts";
import { clamp, num0 } from "./math.ts";
import { iso, nowIso } from "./time.ts";
import type { PolymarketDTO } from "./types.ts";

export type PolymarketTrade = {
  id: string;
  walletId: string;
  address: string;
  chainId: string;
  txHash: string | null;
  marketId: string | null;
  conditionId: string | null;
  eventSlug: string | null;
  marketTitle: string;
  outcome: string;
  side: "buy" | "sell";
  size: number;
  price: number;
  notionalUsd: number;
  timestamp: string;
  observedAt: string;
  source: string;
};

export type WalletPerformanceV2 = {
  walletId: string;
  address: string;
  chainId: string;
  nTrades: number;
  nWins: number;
  nLosses: number;
  winRate: number;
  avgReturnPct: number;
  medianReturnPct: number;
  avgWinPct: number;
  avgLossPct: number;
  payoffRatio: number;
  profitFactor: number;
  realizedPnlUsd: number;
  maxDrawdownPct: number;
  avgHoldingHours: number;
  recentNTrades: number;
  recentReturnPct: number;
  categoryPerformance: Record<string, { nTrades: number; winRate: number; avgReturnPct: number }>;
  qualityScore: number;
  scoreReasons: string[];
  firstSeen: string | null;
  lastSeen: string | null;
};

export type CopySignal = {
  id: string;
  walletId: string;
  address: string;
  marketId: string | null;
  assetId: string | null;
  side: "buy" | "sell";
  walletQualityScore: number;
  copyConfidence: number;
  sourceTradeId: string;
  sourceTradeTimestamp: string;
  observedAt: string;
  latencySeconds: number;
  expectedValue: number;
  reasons: string[];
};

const DATA_API_BASE = "https://data-api.polymarket.com";
const RECENT_WINDOW_MS = 30 * 60_000; // 30 minutes

export async function fetchPolymarketGlobalTrades(limit = 100): Promise<{ trades: PolymarketTrade[]; health: { source: string; status: "up" | "down"; latencyMs: number; error: string | null } }> {
  const url = `${DATA_API_BASE}/trades?limit=${limit}&takerOnly=true`;
  const started = Date.now();
  const res = await fetchJson<Array<Record<string, unknown>>>(url, { timeoutMs: 12_000, retries: 1 });
  const latencyMs = Date.now() - started;
  if (!res.ok || !Array.isArray(res.data)) {
    return { trades: [], health: { source: "polymarket_data_api", status: "down", latencyMs, error: res.error ?? "empty" } };
  }
  const now = nowIso();
  const trades: PolymarketTrade[] = res.data.map((t) => ({
    id: `pm-trade:${String(t.transactionHash ?? t.proxyWallet ?? "")}:${String(t.asset ?? "")}:${String(t.timestamp ?? "")}`,
    walletId: `polygon:${String(t.proxyWallet ?? "").toLowerCase()}`,
    address: String(t.proxyWallet ?? "").toLowerCase(),
    chainId: "polygon",
    txHash: typeof t.transactionHash === "string" ? t.transactionHash : null,
    marketId: String(t.conditionId ?? "").toLowerCase() || null,
    conditionId: String(t.conditionId ?? "").toLowerCase() || null,
    eventSlug: typeof t.eventSlug === "string" ? t.eventSlug : null,
    marketTitle: String(t.title ?? ""),
    outcome: String(t.outcome ?? ""),
    side: String(t.side ?? "").toLowerCase() === "sell" ? "sell" : "buy",
    size: num0(t.size),
    price: num0(t.price),
    notionalUsd: num0(t.size) * num0(t.price),
    timestamp: iso(t.timestamp) ?? now,
    observedAt: now,
    source: "polymarket_data_api",
  }));
  return { trades, health: { source: "polymarket_data_api", status: "up", latencyMs, error: null } };
}

export async function fetchPolymarketWalletTrades(address: string, limit = 100): Promise<PolymarketTrade[]> {
  const url = `${DATA_API_BASE}/trades?user=${encodeURIComponent(address.toLowerCase())}&limit=${limit}`;
  const res = await fetchJson<Array<Record<string, unknown>>>(url, { timeoutMs: 10_000, retries: 1 });
  if (!res.ok || !Array.isArray(res.data)) return [];
  const now = nowIso();
  return res.data.map((t) => ({
    id: `pm-trade:${String(t.transactionHash ?? t.proxyWallet ?? "")}:${String(t.asset ?? "")}:${String(t.timestamp ?? "")}`,
    walletId: `polygon:${String(t.proxyWallet ?? "").toLowerCase()}`,
    address: String(t.proxyWallet ?? "").toLowerCase(),
    chainId: "polygon",
    txHash: typeof t.transactionHash === "string" ? t.transactionHash : null,
    marketId: String(t.conditionId ?? "").toLowerCase() || null,
    conditionId: String(t.conditionId ?? "").toLowerCase() || null,
    eventSlug: typeof t.eventSlug === "string" ? t.eventSlug : null,
    marketTitle: String(t.title ?? ""),
    outcome: String(t.outcome ?? ""),
    side: String(t.side ?? "").toLowerCase() === "sell" ? "sell" : "buy",
    size: num0(t.size),
    price: num0(t.price),
    notionalUsd: num0(t.size) * num0(t.price),
    timestamp: iso(t.timestamp) ?? now,
    observedAt: now,
    source: "polymarket_data_api",
  }));
}

function categoryFromTitle(title: string): string {
  const t = title.toLowerCase();
  if (/\b(fed|fomc|rate|inflation|economy|recession|jobs|cpi|ppi|gdp)\b/.test(t)) return "macro";
  if (/\b(election|trump|biden|vote|gop|democrat|republican|president|senate|house)\b/.test(t)) return "politics";
  if (/\b(btc|bitcoin|eth|ethereum|sol|crypto|etf|sec|regulation)\b/.test(t)) return "crypto";
  if (/\b(war|ukraine|israel|gaza|china|iran|russia|taiwan|sanctions)\b/.test(t)) return "geopolitics";
  return "other";
}

function tradeReturnPct(trade: PolymarketTrade, nextPrice: number | null): number | null {
  if (nextPrice == null || trade.price <= 0) return null;
  // Simple mark-to-model: buy profits if price rises; sell profits if price falls.
  const dir = trade.side === "buy" ? 1 : -1;
  return ((nextPrice - trade.price) / trade.price) * 100 * dir;
}

export function evaluateWalletPerformance(
  trades: PolymarketTrade[],
  marketPrices: Map<string, number>,
  now = Date.now(),
): WalletPerformanceV2 {
  const sorted = [...trades].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const address = sorted[0]?.address ?? "";
  const walletId = sorted[0]?.walletId ?? `polygon:${address}`;

  let wins = 0;
  let losses = 0;
  let totalReturn = 0;
  let totalPnl = 0;
  const returns: number[] = [];
  const winReturns: number[] = [];
  const lossReturns: number[] = [];
  const holdingHours: number[] = [];
  const categoryStats: Record<string, { n: number; wins: number; returns: number[] }> = {};
  let recentTrades = 0;
  let recentReturn = 0;

  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i]!;
    const category = categoryFromTitle(t.marketTitle);
    const next = sorted[i + 1];
    const nextPrice = next && next.conditionId === t.conditionId ? next.price : marketPrices.get(t.conditionId ?? "") ?? null;
    const ret = tradeReturnPct(t, nextPrice);
    const pnl = ret != null ? (ret / 100) * t.notionalUsd : 0;
    if (ret != null) {
      returns.push(ret);
      totalReturn += ret;
      totalPnl += pnl;
      if (ret > 0) {
        wins++;
        winReturns.push(ret);
      } else {
        losses++;
        lossReturns.push(ret);
      }
      const holdH = next ? (Date.parse(next.timestamp) - Date.parse(t.timestamp)) / 3_600_000 : 0;
      holdingHours.push(holdH);
      if (now - Date.parse(t.timestamp) <= 7 * 24 * 60 * 60_000) {
        recentTrades++;
        recentReturn += ret;
      }
    }
    const c = categoryStats[category] ?? { n: 0, wins: 0, returns: [] };
    c.n++;
    if (ret != null && ret > 0) c.wins++;
    if (ret != null) c.returns.push(ret);
    categoryStats[category] = c;
  }

  const n = returns.length;
  const winRate = n ? wins / n : 0;
  const avgReturn = n ? totalReturn / n : 0;
  const sortedR = [...returns].sort((a, b) => a - b);
  const median = n ? sortedR[Math.floor(n / 2)]! : 0;
  const avgWin = wins ? winReturns.reduce((a, b) => a + b, 0) / wins : 0;
  const avgLoss = losses ? lossReturns.reduce((a, b) => a + b, 0) / losses : 0;
  const payoffRatio = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : avgWin > 0 ? 10 : 0;
  const lossAbs = Math.abs(lossReturns.reduce((a, b) => a + b, 0));
  const profitFactor = lossAbs === 0 ? (winReturns.reduce((a, b) => a + b, 0) > 0 ? 10 : 0) : winReturns.reduce((a, b) => a + b, 0) / lossAbs;

  const categoryPerformance: Record<string, { nTrades: number; winRate: number; avgReturnPct: number }> = {};
  for (const [cat, stat] of Object.entries(categoryStats)) {
    categoryPerformance[cat] = {
      nTrades: stat.n,
      winRate: stat.n ? stat.wins / stat.n : 0,
      avgReturnPct: stat.returns.length ? stat.returns.reduce((a, b) => a + b, 0) / stat.returns.length : 0,
    };
  }

  // Cumulative drawdown on per-trade P&L sequence.
  let peak = 0;
  let maxDd = 0;
  let cum = 0;
  for (const ret of returns) {
    cum += (ret / 100);
    if (cum > peak) peak = cum;
    const dd = peak > 0 ? (peak - cum) / peak : 0;
    if (dd > maxDd) maxDd = dd;
  }

  const avgHolding = holdingHours.length ? holdingHours.reduce((a, b) => a + b, 0) / holdingHours.length : 0;

  // Quality score: sample-size adjusted.
  const samplePenalty = Math.min(0.35, Math.max(0, 0.35 - n * 0.03)); // need ~12 trades for full sample credit
  const score = clamp(
    0.25 * winRate +
      0.25 * Math.tanh(avgReturn / 10) +
      0.15 * Math.tanh(payoffRatio / 2) +
      0.15 * Math.tanh(profitFactor / 2) +
      0.1 * Math.tanh(recentReturn / 10) +
      0.1 * (1 - samplePenalty),
    0,
    1,
  );

  const reasons = [
    `${n} completed round-trip trades`,
    `${wins} wins / ${losses} losses (${(winRate * 100).toFixed(0)}%)`,
    `avg return ${avgReturn.toFixed(2)}%, median ${median.toFixed(2)}%`,
    `payoff ratio ${payoffRatio.toFixed(2)}, profit factor ${profitFactor.toFixed(2)}`,
    `recent (7d) ${recentTrades} trades @ ${recentReturn.toFixed(2)}%`,
    samplePenalty > 0.05 ? "small sample — score discounted" : "sufficient sample",
  ];

  return {
    walletId,
    address,
    chainId: "polygon",
    nTrades: n,
    nWins: wins,
    nLosses: losses,
    winRate,
    avgReturnPct: avgReturn,
    medianReturnPct: median,
    avgWinPct: avgWin,
    avgLossPct: avgLoss,
    payoffRatio,
    profitFactor,
    realizedPnlUsd: totalPnl,
    maxDrawdownPct: maxDd * 100,
    avgHoldingHours: avgHolding,
    recentNTrades: recentTrades,
    recentReturnPct: recentReturn,
    categoryPerformance,
    qualityScore: score,
    scoreReasons: reasons,
    firstSeen: sorted[0]?.timestamp ?? null,
    lastSeen: sorted[sorted.length - 1]?.timestamp ?? null,
  };
}

export function walletConsensus(wallets: WalletPerformanceV2[], minQuality = 0.3): { consensus: number; topWallets: string[] } {
  const active = wallets.filter((w) => w.qualityScore >= minQuality && w.nTrades >= 3);
  if (active.length < 2) return { consensus: 0, topWallets: [] };
  const avgQuality = active.reduce((a, w) => a + w.qualityScore, 0) / active.length;
  const consensus = clamp(avgQuality * Math.tanh(active.length / 3), 0, 1);
  return { consensus, topWallets: active.slice(0, 5).map((w) => w.address) };
}

export function generateCopySignals(opts: {
  trades: PolymarketTrade[];
  wallets: Map<string, WalletPerformanceV2>;
  markets: PolymarketDTO[];
  assetMap: Map<string, string>; // market conditionId -> assetId
  now?: number;
}): CopySignal[] {
  const now = opts.now ?? Date.now();
  const out: CopySignal[] = [];
  const marketPrices = new Map(opts.markets.map((m) => [String(m.id).toLowerCase(), num0(m.probability)]));

  const recent = opts.trades
    .filter((t) => now - Date.parse(t.timestamp) <= RECENT_WINDOW_MS)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

  for (const t of recent) {
    const perf = opts.wallets.get(t.walletId);
    if (!perf || perf.qualityScore < 0.25) continue;
    const currentPrice = marketPrices.get(t.conditionId ?? "") ?? t.price;
    const expectedMove = t.side === "buy" ? Math.max(0, (currentPrice - t.price) / t.price) * 100 : Math.max(0, (t.price - currentPrice) / t.price) * 100;
    const latencySeconds = Math.max(0, (now - Date.parse(t.timestamp)) / 1000);
    const timingDecay = Math.exp(-latencySeconds / 600);
    const category = categoryFromTitle(t.marketTitle);
    const categoryEdge = perf.categoryPerformance[category]?.avgReturnPct ?? 0;
    const copyConfidence = clamp(
      0.35 * perf.qualityScore +
        0.2 * Math.tanh(expectedMove / 5) +
        0.15 * timingDecay +
        0.15 * Math.tanh(categoryEdge / 10) +
        0.15 * Math.min(1, perf.nTrades / 10),
      0,
      0.92,
    );
    const ev = expectedMove * copyConfidence - (1 - copyConfidence) * Math.abs(expectedMove) * 0.5;
    out.push({
      id: `copy:${t.id}`,
      walletId: t.walletId,
      address: t.address,
      marketId: t.conditionId,
      assetId: opts.assetMap.get(t.conditionId ?? "") ?? null,
      side: t.side,
      walletQualityScore: perf.qualityScore,
      copyConfidence,
      sourceTradeId: t.id,
      sourceTradeTimestamp: t.timestamp,
      observedAt: nowIso(),
      latencySeconds,
      expectedValue: ev,
      reasons: [
        `Wallet quality ${(perf.qualityScore * 100).toFixed(0)}%`,
        `${perf.nTrades} trades, ${(perf.winRate * 100).toFixed(0)}% wins`,
        `${category} category edge ${categoryEdge.toFixed(2)}%`,
        `Latency ${latencySeconds.toFixed(0)}s`,
      ],
    });
  }

  // Deduplicate by wallet+market+side, keep highest confidence.
  const dedup = new Map<string, CopySignal>();
  for (const s of out) {
    const key = `${s.walletId}:${s.marketId}:${s.side}`;
    const prev = dedup.get(key);
    if (!prev || s.copyConfidence > prev.copyConfidence) dedup.set(key, s);
  }
  return [...dedup.values()].sort((a, b) => b.copyConfidence - a.copyConfidence);
}
