import { maxDrawdown, mean, sharpe, sortino } from "./math.ts";
import type { BacktestMetrics, EquityPoint } from "./types.ts";

export type Candle = {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type BacktestTrade = {
  entryTime: number;
  exitTime: number;
  side: "long";
  entry: number;
  exit: number;
  returnPct: number;
  feesPct: number;
  realizedPnlUsd: number;
  reason: string;
};

export type BacktestResult = {
  metrics: BacktestMetrics;
  equityCurve: EquityPoint[];
  trades: BacktestTrade[];
  notes: string;
};

export type MomentumParams = {
  lookback: number;
  entryPct: number;
  exitPct: number;
  holdBars: number;
  feeBps: number;
  slippageBps: number;
};

export const DEFAULT_MOMENTUM: MomentumParams = {
  lookback: 5,
  entryPct: 3,
  exitPct: -2.5,
  holdBars: 10,
  feeBps: 30,
  slippageBps: 12,
};

function spendForQty(qty: number, px: number): number {
  return qty * px;
}

function computeMetrics(opts: {
  candles: readonly Candle[];
  curve: EquityPoint[];
  trades: BacktestTrade[];
  investedBars: number;
  startingEquity: number;
  params: MomentumParams;
  benchmark?: { buyHoldReturnPct: number };
}): BacktestMetrics {
  const { candles, curve, trades, investedBars, startingEquity, params, benchmark } = opts;
  const rets = trades.map((t) => t.returnPct / 100);
  const wins = trades.filter((t) => t.returnPct > 0);
  const losses = trades.filter((t) => t.returnPct <= 0);
  const gain = wins.reduce((a, t) => a + t.returnPct, 0);
  const lossAbs = Math.abs(losses.reduce((a, t) => a + t.returnPct, 0));
  const eq0 = curve[0]?.equity ?? startingEquity;
  const eqN = curve[curve.length - 1]?.equity ?? startingEquity;
  const totalReturnPct = eq0 ? ((eqN - eq0) / eq0) * 100 : 0;
  const days = candles.length;
  const annualized = days > 10 ? (Math.pow(eqN / eq0, 365 / days) - 1) * 100 : null;
  const sorted = [...trades.map((t) => t.returnPct)].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;

  let consec = 0;
  let maxConsec = 0;
  for (const t of trades) {
    if (t.returnPct <= 0) {
      consec += 1;
      maxConsec = Math.max(maxConsec, consec);
    } else consec = 0;
  }

  const avgWin = wins.length ? mean(wins.map((t) => t.returnPct)) : 0;
  const avgLoss = losses.length ? mean(losses.map((t) => t.returnPct)) : 0;
  const payoffRatio = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : avgWin > 0 ? 10 : 0;
  const expectancy = trades.length ? mean(trades.map((t) => t.returnPct)) : 0;
  const totalFeesUsd = trades.reduce((a, t) => a + Math.abs(t.entry * 0.5 * (t.feesPct / 100)), 0);
  const totalSlippageUsd = trades.reduce((a, t) => {
    const halfFeeFrac = (t.feesPct / 100) * 0.5;
    // Slippage is the non-fee half of the round-trip cost assumption.
    return a + Math.abs(t.entry * 0.5 * halfFeeFrac);
  }, 0);

  const calmar = maxDrawdown(curve.map((p) => p.equity));
  const calmarRatio = calmar > 0 && annualized != null ? annualized / (calmar * 100) : null;

  return {
    totalReturnPct,
    annualizedReturnPct: annualized,
    sharpe: trades.length < 8 ? 0 : sharpe(rets, 365 / Math.max(1, params.holdBars || 5)),
    sortino: trades.length < 8 ? 0 : sortino(rets, 365 / Math.max(1, params.holdBars || 5)),
    maxDrawdownPct: calmar * 100,
    winRate: trades.length ? wins.length / trades.length : 0,
    profitFactor: lossAbs === 0 ? (gain > 0 ? 10 : 0) : gain / lossAbs,
    avgTradePct: mean(trades.map((t) => t.returnPct)),
    medianTradePct: median,
    nTrades: trades.length,
    exposurePct: candles.length ? (investedBars / candles.length) * 100 : 0,
    feesUsd: totalFeesUsd,
    slippageUsd: totalSlippageUsd,
    bestTradePct: trades.reduce((a, t) => Math.max(a, t.returnPct), 0),
    worstTradePct: trades.reduce((a, t) => Math.min(a, t.returnPct), 0),
    consecutiveLosses: maxConsec,
    avgWinPct: avgWin,
    avgLossPct: avgLoss,
    payoffRatio,
    expectancy,
    calmar: calmarRatio,
    benchmarkReturnPct: benchmark?.buyHoldReturnPct ?? null,
    benchmarkOutperformancePct:
      benchmark?.buyHoldReturnPct != null ? totalReturnPct - benchmark.buyHoldReturnPct : null,
    capacityNote: "Capacity unknown — single-name, no participation constraint.",
  };
}

function buildNotes(trades: BacktestTrade[], benchmark?: { buyHoldReturnPct: number }): string {
  const parts = [
    "Fills: buy next bar open, sell this bar close.",
    "Costs applied on both sides (fee+slippage).",
    "No look-ahead: signal uses close[i] vs close[i-lookback] only.",
    "This is a baseline, not an optimized production strategy.",
    trades.length < 8 ? "Too few trades for statistical confidence." : "Sample remains small — treat Sharpe as descriptive.",
  ];
  if (benchmark?.buyHoldReturnPct != null) {
    parts.push(`Buy-and-hold benchmark: ${benchmark.buyHoldReturnPct.toFixed(2)}%.`);
  }
  return parts.join(" ");
}

/**
 * Walk a candle series with NO look-ahead: at bar i we only know closes[0..i].
 * Entry is filled at the NEXT bar's open (cannot trade the close we just saw).
 */
export function runMomentumBacktest(
  candles: readonly Candle[],
  params: MomentumParams = DEFAULT_MOMENTUM,
  startingEquity = 10_000,
  benchmark?: { buyHoldReturnPct: number },
): BacktestResult {
  const trades: BacktestTrade[] = [];
  const curve: EquityPoint[] = [];
  const _startingEquity = startingEquity;
  let cash = _startingEquity;
  let qty = 0;
  let entryPx: number | null = null;
  let barsHeld = 0;
  let pendingBuy = false;
  const feeFrac = (params.feeBps + params.slippageBps) / 10_000;
  let investedBars = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;

    if (pendingBuy && qty === 0) {
      const px = c.open * (1 + feeFrac);
      const spend = cash;
      if (px > 0 && spend > 0) {
        qty = spend / px;
        cash = 0;
        entryPx = px;
        barsHeld = 0;
      }
      pendingBuy = false;
    }

    const equity = cash + qty * c.close;
    curve.push({ t: new Date(c.t).toISOString(), equity: Math.round(equity * 100) / 100 });
    if (qty > 0) investedBars++;

    if (qty > 0) {
      barsHeld++;
      if (entryPx == null) continue;
      const pnlPct = (c.close - entryPx) / entryPx;
      const timeExit = barsHeld >= params.holdBars;
      const stop = pnlPct <= params.exitPct / 100;
      const last = i === candles.length - 1;
      if (timeExit || stop || last) {
        const exitPx = c.close * (1 - feeFrac);
        const proceeds = qty * exitPx;
        const ret = (exitPx - entryPx) / entryPx;
        const prev = i - barsHeld;
        const entryTime =
          prev >= 0 && barsHeld > 0
            ? c.t - ((c.t - candles[prev]!.t) / barsHeld)
            : c.t;
        trades.push({
          entryTime,
          exitTime: c.t,
          side: "long",
          entry: entryPx,
          exit: exitPx,
          returnPct: ret * 100,
          feesPct: feeFrac * 2 * 100,
          realizedPnlUsd: proceeds - spendForQty(qty, entryPx),
          reason: last ? "end" : stop ? "stop" : "time",
        });
        cash = proceeds;
        qty = 0;
        entryPx = null;
        barsHeld = 0;
      }
      continue;
    }

    if (i < params.lookback) continue;
    const past = candles[i - params.lookback]!;
    if (!(past.close > 0)) continue;
    const chg = ((c.close - past.close) / past.close) * 100;
    if (chg >= params.entryPct) pendingBuy = true;
  }

  const metrics = computeMetrics({ candles, curve, trades, investedBars, startingEquity: _startingEquity, params, benchmark });
  return { metrics, equityCurve: curve, trades, notes: buildNotes(trades, benchmark) };
}

export function runBuyHoldBenchmark(candles: readonly Candle[], _startingEquity = 10_000): number {
  if (!candles.length) return 0;
  const first = candles[0]!.open;
  const last = candles[candles.length - 1]!.close;
  if (!first) return 0;
  return ((last - first) / first) * 100;
}

export function runRandomEntryBacktest(
  candles: readonly Candle[],
  params: Omit<MomentumParams, "lookback" | "entryPct"> & { entryFrequency?: number },
  startingEquity = 10_000,
): BacktestResult {
  const trades: BacktestTrade[] = [];
  const curve: EquityPoint[] = [];
  let cash = startingEquity;
  let qty = 0;
  let entryPx: number | null = null;
  let barsHeld = 0;
  const feeFrac = (params.feeBps + params.slippageBps) / 10_000;
  let investedBars = 0;
  const freq = params.entryFrequency ?? 10;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;

    if (qty === 0 && i > 0 && i % freq === 0) {
      const px = c.open * (1 + feeFrac);
      if (px > 0 && cash > 0) {
        qty = cash / px;
        cash = 0;
        entryPx = px;
        barsHeld = 0;
      }
    }

    const equity = cash + qty * c.close;
    curve.push({ t: new Date(c.t).toISOString(), equity: Math.round(equity * 100) / 100 });
    if (qty > 0) investedBars++;

    if (qty > 0) {
      barsHeld++;
      if (entryPx == null) continue;
      const pnlPct = (c.close - entryPx) / entryPx;
      const timeExit = barsHeld >= params.holdBars;
      const stop = pnlPct <= params.exitPct / 100;
      const last = i === candles.length - 1;
      if (timeExit || stop || last) {
        const exitPx = c.close * (1 - feeFrac);
        const proceeds = qty * exitPx;
        const ret = (exitPx - entryPx) / entryPx;
        const prev = i - barsHeld;
        const entryTime = prev >= 0 && barsHeld > 0 ? c.t - (c.t - candles[prev]!.t) / barsHeld : c.t;
        trades.push({
          entryTime,
          exitTime: c.t,
          side: "long",
          entry: entryPx,
          exit: exitPx,
          returnPct: ret * 100,
          feesPct: feeFrac * 2 * 100,
          realizedPnlUsd: proceeds - spendForQty(qty, entryPx),
          reason: last ? "end" : stop ? "time" : "time",
        });
        cash = proceeds;
        qty = 0;
        entryPx = null;
        barsHeld = 0;
      }
    }
  }

  const mergedParams: MomentumParams = { ...DEFAULT_MOMENTUM, ...params, lookback: 0, entryPct: 0 };
  const metrics = computeMetrics({ candles, curve, trades, investedBars, startingEquity, params: mergedParams });
  return { metrics, equityCurve: curve, trades, notes: buildNotes(trades) };
}

export function walkForwardSplit<T>(rows: readonly T[], inSamplePct = 0.7): { inSample: T[]; outOfSample: T[] } {
  const cut = Math.max(1, Math.floor(rows.length * inSamplePct));
  return { inSample: rows.slice(0, cut), outOfSample: rows.slice(cut) };
}

export function rollingWalkForward<T>(
  rows: readonly T[],
  opts: { trainSize: number; testSize: number },
): { train: T[]; test: T[] }[] {
  const out: { train: T[]; test: T[] }[] = [];
  let start = 0;
  while (start + opts.trainSize + opts.testSize <= rows.length) {
    out.push({
      train: rows.slice(start, start + opts.trainSize),
      test: rows.slice(start + opts.trainSize, start + opts.trainSize + opts.testSize),
    });
    start += opts.testSize;
  }
  return out;
}
