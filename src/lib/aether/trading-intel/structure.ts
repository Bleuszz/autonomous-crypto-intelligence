import { candlesAsOf, lastCandle } from "./candles.ts";
import type { MarketStructureState, Ohlcv, StructureEvent, Timeframe } from "./types.ts";
export type Swing = { kind: "high" | "low"; price: number; t: number; index: number };
export function detectSwings(candles: Ohlcv[], leftRight = 2): Swing[] {
  const out: Swing[] = [];
  if (candles.length < leftRight * 2 + 1) return out;
  for (let i = leftRight; i < candles.length - leftRight; i++) {
    const c = candles[i]!;
    let isHigh = true, isLow = true;
    for (let j = i - leftRight; j <= i + leftRight; j++) {
      if (j === i) continue;
      if (candles[j]!.h >= c.h) isHigh = false;
      if (candles[j]!.l <= c.l) isLow = false;
    }
    if (isHigh) out.push({ kind: "high", price: c.h, t: c.t, index: i });
    else if (isLow) out.push({ kind: "low", price: c.l, t: c.t, index: i });
  }
  return out;
}
function iso(t: number) { return new Date(t).toISOString(); }
export function detectStructure(opts: { timeframe: Timeframe; candles: Ohlcv[] | undefined; decisionTimestamp: string }): MarketStructureState {
  const candles = candlesAsOf(opts.candles, opts.decisionTimestamp);
  const last = lastCandle(candles);
  const empty = (): MarketStructureState => ({ timeframe: opts.timeframe, timestamp: opts.decisionTimestamp, bias: "neutral", regime: "unknown", events: [], lastSwingHigh: null, lastSwingLow: null, freshness: candles.length ? "INSUFFICIENT" : "UNAVAILABLE" });
  if (!last || candles.length < 12) return empty();
  const swings = detectSwings(candles, 2);
  const highs = swings.filter(s => s.kind === "high");
  const lows = swings.filter(s => s.kind === "low");
  const lastHigh = highs.at(-1) ?? null;
  const prevHigh = highs.length >= 2 ? highs[highs.length-2]! : null;
  const lastLow = lows.at(-1) ?? null;
  const prevLow = lows.length >= 2 ? lows[lows.length-2]! : null;
  const events: MarketStructureState["events"] = [];
  const push = (kind: StructureEvent, price: number, t: number, note: string) => { events.push({ kind, price, at: iso(t), note }); };
  if (lastHigh && prevHigh) push(lastHigh.price > prevHigh.price ? "HH" : "LH", lastHigh.price, lastHigh.t, lastHigh.price > prevHigh.price ? "Higher high" : "Lower high");
  if (lastLow && prevLow) push(lastLow.price > prevLow.price ? "HL" : "LL", lastLow.price, lastLow.t, lastLow.price > prevLow.price ? "Higher low" : "Lower low");
  const hh = !!(lastHigh && prevHigh && lastHigh.price > prevHigh.price);
  const hl = !!(lastLow && prevLow && lastLow.price > prevLow.price);
  const lh = !!(lastHigh && prevHigh && lastHigh.price < prevHigh.price);
  const ll = !!(lastLow && prevLow && lastLow.price < prevLow.price);
  let bias: MarketStructureState["bias"] = "neutral";
  let regime: MarketStructureState["regime"] = "unknown";
  if (hh && hl) { bias = "bullish"; regime = "trend"; push("TREND", last.c, last.t, "HH + HL"); }
  else if (lh && ll) { bias = "bearish"; regime = "trend"; push("TREND", last.c, last.t, "LH + LL"); }
  else if (lastHigh && lastLow && Math.abs(lastHigh.price - lastLow.price) / last.c < 0.04) { regime = "range"; push("RANGE", last.c, last.t, "Tight swing range"); }
  else if (highs.length + lows.length >= 4) { regime = "consolidation"; push("CONSOLIDATION", last.c, last.t, "Mixed swings"); }
  if (lastHigh && last.c > lastHigh.price) { push("BOS", last.c, last.t, "Close through last swing high"); push(bias === "bearish" ? "CHOCH" : "BREAKOUT", last.c, last.t, bias === "bearish" ? "Bearish structure broken" : "Break of swing high"); }
  if (lastLow && last.c < lastLow.price) { push("BOS", last.c, last.t, "Close through last swing low"); push(bias === "bullish" ? "CHOCH" : "BREAKOUT", last.c, last.t, bias === "bullish" ? "Bullish structure broken" : "Break of swing low"); }
  const recent = candles.slice(-6), earlier = candles.slice(-12, -6);
  if (recent.length === 6 && earlier.length === 6) {
    const range = (xs: Ohlcv[]) => Math.max(...xs.map(c => c.h)) - Math.min(...xs.map(c => c.l));
    const r1 = range(earlier), r2 = range(recent);
    if (r1 > 0 && r2 / r1 >= 1.6) push("VOL_EXPANSION", last.c, last.t, "Range expanded ≥1.6x");
    if (r1 > 0 && r2 / r1 <= 0.6) push("VOL_CONTRACTION", last.c, last.t, "Range contracted ≤0.6x");
  }
  if (lastHigh && last.c < lastHigh.price && last.h >= lastHigh.price) push("REJECTION", lastHigh.price, last.t, "Wick rejected last swing high");
  if (lastLow && last.c > lastLow.price && last.l <= lastLow.price) push("REJECTION", lastLow.price, last.t, "Wick rejected last swing low");
  const body = Math.abs(last.c - last.o), wick = last.h - last.l;
  if (wick > 0 && body / wick < 0.25 && (last.h - last.c) / wick > 0.5) push("EXHAUSTION", last.c, last.t, "Long upper wick vs body");
  if (events.some(e => e.kind === "BREAKOUT") && events.some(e => e.kind === "REJECTION")) push("FAILED_BREAKOUT", last.c, last.t, "Break attempt immediately rejected");
  return { timeframe: opts.timeframe, timestamp: opts.decisionTimestamp, bias, regime, events, lastSwingHigh: lastHigh ? { price: lastHigh.price, t: lastHigh.t } : null, lastSwingLow: lastLow ? { price: lastLow.price, t: lastLow.t } : null, freshness: "AVAILABLE" };
}
