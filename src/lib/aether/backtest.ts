import { maxDrawdown, mean, sharpe, sortino } from "./math.ts";
import type { BacktestMetrics, EquityPoint } from "./types.ts";

export type Candle = {
  t: number; // unix ms, open time
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

/**
 * Walk a candle series with NO look-ahead: at bar i we only know closes[0..i].
 * Entry is filled at the NEXT bar's open (cannot trade the close we just saw).
 */
export function runMomentumBacktest(
  candles: Candle[],
  params: MomentumParams = DEFAULT_MOMENTUM,
  startingEquity = 10_000,
): BacktestResult {
  const trades: BacktestTrade[] = [];
  const curve: EquityPoint[] = [];
  let cash = startingEquity;
  let qty = 0;
  let entryPx = 0;
  let entryTime = 0;
  let entryBar = -1;
  let barsHeld = 0;
  let peak = startingEquity;
  const roundReturns: number[] = [];

  const feeFrac = (params.feeBps + params.slippageBps) / 10_000;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const equity = qty > 0 ? cash + qty * c.close : cash;
    peak = Math.max(peak, equity);
    curve.push({ t: new Date(c.t).toISOString(), equity: Math.round(equity * 100) / 100 });

    if (qty > 0) {
      barsHeld++;
      const pnlPct = (c.close - entryPx) / entryPx;
      const timeExit = barsHeld >= params.holdBars;
      const stop = pnlPct <= params.exitPct / 100;
      const last = i === candles.length - 1;
      if (timeExit || stop || last) {
        // Fill at this bar close (already observed). Conservative vs next-open for exits.
        const exitPx = c.close * (1 - feeFrac);
        const proceeds = qty * exitPx;
        const ret = (exitPx - entryPx) / entryPx;
        trades.push({
          entryTime,
          exitTime: c.t,
          side: "long",
          entry: entryPx,
          exit: exitPx,
          returnPct: ret * 100,
          feesPct: feeFrac * 2 * 100,
          reason: last ? "end" : stop ? "stop" : "time",
        });
        roundReturns.push(ret);
        cash = proceeds;
        qty = 0;
        entryPx = 0;
        barsHeld = 0;
      }
      continue;
    }

    if (i < params.lookback + 1) continue;
    // Signal uses close[i] vs close[i-lookback]; fill happens next bar (handled by waiting until the next iteration via pending flag).
    // To avoid look-ahead we store a pending buy to fill at next open.
  }

  // Second pass with explicit pending-buy to fill at next open.
  return runMomentumWithNextOpenFill(candles, params, startingEquity);
}

function runMomentumWithNextOpenFill(
  candles: Candle[],
  params: MomentumParams,
  startingEquity: number,
): BacktestResult {
  const trades: BacktestTrade[] = [];
  const curve: EquityPoint[] = [];
  let cash = startingEquity;
  let qty = 0;
  let entryPx = 0;
  let entryTime = 0;
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
        entryTime = c.t;
        barsHeld = 0;
      }
      pendingBuy = false;
    }

    const equity = cash + qty * c.close;
    curve.push({ t: new Date(c.t).toISOString(), equity: Math.round(equity * 100) / 100 });
    if (qty > 0) investedBars++;

    if (qty > 0) {
      barsHeld++;
      const pnlPct = (c.close - entryPx) / entryPx;
      const timeExit = barsHeld >= params.holdBars;
      const stop = pnlPct <= params.exitPct / 100;
      const last = i === candles.length - 1;
      if (timeExit || stop || last) {
        const exitPx = c.close * (1 - feeFrac);
        const proceeds = qty * exitPx;
        const ret = (exitPx - entryPx) / entryPx;
        trades.push({
          entryTime,
          exitTime: c.t,
          side: "long",
          entry: entryPx,
          exit: exitPx,
          returnPct: ret * 100,
          feesPct: feeFrac * 2 * 100,
          reason: last ? "end" : stop ? "stop" : "time",
        });
        cash = proceeds;
        qty = 0;
        entryPx = 0;
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

  const notes = [
    "Fills: buy next bar open, sell this bar close.",
    "Costs applied on both sides (fee+slippage).",
    "No look-ahead: signal uses close[i] vs close[i-lookback] only.",
    "This is a baseline, not an optimized production strategy.",
    trades.length < 8 ? "Too few trades for statistical confidence." : "Sample remains small — treat Sharpe as descriptive.",
  ].join(" ");

  const metrics: BacktestMetrics = {
    totalReturnPct,
    annualizedReturnPct: annualized,
    sharpe: sharpe(rets.map((r) => r), 365 / Math.max(1, (params.holdBars || 5))),
    sortino: sortino(rets),
    maxDrawdownPct: maxDrawdown(curve.map((p) => p.equity)) * 100,
    winRate: trades.length ? wins.length / trades.length : 0,
    profitFactor: lossAbs === 0 ? (gain > 0 ? 10 : 0) : gain / lossAbs,
    avgTradePct: mean(trades.map((t) => t.returnPct)),
    medianTradePct: median,
    nTrades: trades.length,
    exposurePct: candles.length ? (investedBars / candles.length) * 100 : 0,
    feesUsd: trades.reduce((a, t) => a + Math.abs(t.entry * 0.5 * (t.feesPct / 100)), 0),
    slippageUsd: 0,
    bestTradePct: trades.reduce((a, t) => Math.max(a, t.returnPct), 0),
    worstTradePct: trades.reduce((a, t) => Math.min(a, t.returnPct), 0),
    consecutiveLosses: maxConsec,
    capacityNote: "Capacity unknown — single-name, no participation constraint.",
  };

  return { metrics, equityCurve: curve, trades, notes };
}

export function walkForwardSplit<T>(rows: T[], inSamplePct = 0.7): { inSample: T[]; outOfSample: T[] } {
  const cut = Math.max(1, Math.floor(rows.length * inSamplePct));
  return { inSample: rows.slice(0, cut), outOfSample: rows.slice(cut) };
}
