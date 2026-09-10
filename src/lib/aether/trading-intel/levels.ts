import { candlesAsOf, lastCandle } from "./candles.ts";
import { vwap } from "./indicators.ts";
import { detectSwings } from "./structure.ts";
import type { Ohlcv, SupportResistanceLevel, Timeframe } from "./types.ts";
export function detectLevels(opts: { timeframe: Timeframe; candles: Ohlcv[] | undefined; decisionTimestamp: string }): SupportResistanceLevel[] {
  const candles = candlesAsOf(opts.candles, opts.decisionTimestamp);
  const last = lastCandle(candles);
  if (!last || candles.length < 12) return [];
  const raw: SupportResistanceLevel[] = [];
  for (const s of detectSwings(candles, 2)) {
    raw.push({ level: s.price, timeframe: opts.timeframe, kind: s.price >= last.c ? "resistance" : "support", strength: 0.45, touches: 1, distancePct: ((s.price - last.c) / last.c) * 100, freshness: "AVAILABLE", confidence: 0.45, evidence: `${s.kind} swing on ${opts.timeframe}` });
  }
  const window = candles.slice(-20);
  const rangeHigh = Math.max(...window.map(c => c.h));
  const rangeLow = Math.min(...window.map(c => c.l));
  raw.push({ level: rangeHigh, timeframe: opts.timeframe, kind: "resistance", strength: 0.4, touches: 1, distancePct: ((rangeHigh - last.c) / last.c) * 100, freshness: "AVAILABLE", confidence: 0.4, evidence: "Recent consolidation high" });
  raw.push({ level: rangeLow, timeframe: opts.timeframe, kind: "support", strength: 0.4, touches: 1, distancePct: ((rangeLow - last.c) / last.c) * 100, freshness: "AVAILABLE", confidence: 0.4, evidence: "Recent consolidation low" });
  const v = vwap(candles);
  if (v != null) raw.push({ level: v, timeframe: opts.timeframe, kind: "vwap", strength: 0.55, touches: 1, distancePct: ((v - last.c) / last.c) * 100, freshness: "AVAILABLE", confidence: 0.5, evidence: "Volume-weighted average price" });
  return raw.sort((a,b) => Math.abs(a.distancePct) - Math.abs(b.distancePct)).slice(0, 8);
}
