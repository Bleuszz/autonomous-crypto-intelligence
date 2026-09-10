import type { Ohlcv, Timeframe } from "./types.ts";

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1D": 24 * 60 * 60_000,
};

export function parseDecisionMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

export function candlesAsOf(candles: Ohlcv[] | undefined, decisionIso: string): Ohlcv[] {
  if (!candles?.length) return [];
  const cutoff = parseDecisionMs(decisionIso);
  return candles
    .filter((c) => Number.isFinite(c.t) && c.t <= cutoff)
    .filter((c) => Number.isFinite(c.o) && Number.isFinite(c.h) && Number.isFinite(c.l) && Number.isFinite(c.c))
    .filter((c) => c.o > 0 && c.h > 0 && c.l > 0 && c.c > 0)
    .sort((a, b) => a.t - b.t);
}

export function assertNoLookahead(candles: Ohlcv[], decisionIso: string): boolean {
  const cutoff = parseDecisionMs(decisionIso);
  return candles.every((c) => c.t <= cutoff);
}

export function closes(candles: Ohlcv[]): number[] {
  return candles.map((c) => c.c);
}

export function typicalPrice(c: Ohlcv): number {
  return (c.h + c.l + c.c) / 3;
}

export function candlesFromSparkline(spark: number[] | null | undefined, lastCloseMs: number): Ohlcv[] {
  if (!spark || spark.length < 8) return [];
  const xs = spark.filter((n) => Number.isFinite(n) && n > 0);
  if (xs.length < 8) return [];
  const step = TIMEFRAME_MS["1D"];
  return xs.map((c, i) => {
    const t = lastCloseMs - (xs.length - 1 - i) * step;
    const prev = xs[i - 1] ?? c;
    return { t, o: prev, h: Math.max(prev, c), l: Math.min(prev, c), c, v: null };
  });
}

export function lastCandle(candles: Ohlcv[]): Ohlcv | null {
  return candles.length ? candles[candles.length - 1]! : null;
}
