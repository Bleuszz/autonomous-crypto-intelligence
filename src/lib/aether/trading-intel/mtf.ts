import { candlesAsOf } from "./candles.ts";
import { atr, ema, rsi } from "./indicators.ts";
import { detectStructure } from "./structure.ts";
import type { Bias, MultiTimeframeState, Ohlcv, Timeframe, TimeframeSlice } from "./types.ts";
const TFS: Timeframe[] = ["5m", "15m", "1h", "4h", "1D"];
function volLabel(candles: Ohlcv[]): TimeframeSlice["volatility"] {
  if (candles.length < 20) return "UNAVAILABLE";
  const a = atr(candles, 14); const last = candles[candles.length-1]!;
  if (a == null || !(last.c > 0)) return "UNAVAILABLE";
  const pct = (a / last.c) * 100;
  if (pct >= 3.5) return "expansion";
  if (pct <= 1.1) return "contraction";
  return "normal";
}
function momentumBias(closes: number[]): Bias | "UNAVAILABLE" {
  const r = rsi(closes, 14); const e = ema(closes, 21); const last = closes.at(-1);
  if (r == null && e == null) return "UNAVAILABLE";
  let score = 0;
  if (r != null) score += r > 55 ? 1 : r < 45 ? -1 : 0;
  if (e != null && last != null) score += last > e ? 1 : last < e ? -1 : 0;
  return score > 0 ? "bullish" : score < 0 ? "bearish" : "neutral";
}
export function analyzeMultiTimeframe(opts: { candlesByTf: Partial<Record<Timeframe, Ohlcv[]>>; decisionTimestamp: string }): MultiTimeframeState {
  const slices: TimeframeSlice[] = TFS.map((tf) => {
    const candles = candlesAsOf(opts.candlesByTf[tf], opts.decisionTimestamp);
    if (candles.length < 12) return { timeframe: tf, bias: "UNAVAILABLE", momentum: "UNAVAILABLE", structure: "UNAVAILABLE", volatility: "UNAVAILABLE", available: false };
    const structure = detectStructure({ timeframe: tf, candles, decisionTimestamp: opts.decisionTimestamp });
    return { timeframe: tf, bias: structure.bias, momentum: momentumBias(candles.map(c => c.c)), structure: structure.bias, volatility: volLabel(candles), available: true };
  });
  const available = slices.filter(s => s.available);
  const trendSides = available.map(s => s.bias).filter((b): b is Bias => b !== "neutral" && b !== "UNAVAILABLE");
  const momSides = available.map(s => s.momentum).filter((b): b is Bias => b !== "UNAVAILABLE" && b !== "neutral");
  const align = (sides: Bias[]): MultiTimeframeState["trendAlignment"] => {
    if (sides.length < 2) return "insufficient";
    if (sides.every(s => s === "bullish")) return "aligned_bull";
    if (sides.every(s => s === "bearish")) return "aligned_bear";
    return "conflict";
  };
  const trendAlignment = align(trendSides);
  const momentumAlignment = align(momSides);
  const htf = slices.find(s => s.timeframe === "1D" || s.timeframe === "4h");
  const ltf = slices.find(s => s.timeframe === "15m" || s.timeframe === "1h");
  let note = "INSUFFICIENT multi-timeframe candles";
  if (available.length) {
    if (htf?.bias === "bearish" && (ltf?.bias === "bullish" || ltf?.momentum === "bullish")) note = "Lower-timeframe strength inside a higher-timeframe downtrend";
    else if (htf?.bias === "bullish" && (ltf?.bias === "bearish" || ltf?.momentum === "bearish")) note = "Lower-timeframe weakness inside a higher-timeframe uptrend";
    else if (trendAlignment === "aligned_bull") note = "Available timeframes agree bullish";
    else if (trendAlignment === "aligned_bear") note = "Available timeframes agree bearish";
    else if (trendAlignment === "conflict") note = "Timeframe trend conflict";
    else note = `${available.length} timeframe(s) available — others UNAVAILABLE`;
  }
  return { slices, trendAlignment, momentumAlignment, note };
}
