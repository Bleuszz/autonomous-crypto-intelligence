import type { IndicatorAblation } from "./types.ts";
export type FoldTrade = { nextReturnPct: number; featuresOn: boolean };
export function walkForwardExpectancy(trades: FoldTrade[], foldSize: number): number | null {
  if (trades.length < foldSize * 2) return null;
  const oos: number[] = [];
  for (let start = foldSize; start < trades.length; start += foldSize) {
    const fold = trades.slice(start, start + foldSize);
    if (!fold.length) continue;
    oos.push(fold.reduce((a, t) => a + t.nextReturnPct, 0) / fold.length);
  }
  if (!oos.length) return null;
  return oos.reduce((a, b) => a + b, 0) / oos.length;
}
export function ablationReport(opts: { name: string; baseline: number[]; withFeature: number[] }): IndicatorAblation {
  const n = Math.min(opts.baseline.length, opts.withFeature.length);
  if (n < 20) return { name: opts.name, baselineExpectancy: null, withIndicatorExpectancy: null, delta: null, n, verdict: "INSUFFICIENT EVIDENCE" };
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const baselineExpectancy = mean(opts.baseline.slice(0, n));
  const withIndicatorExpectancy = mean(opts.withFeature.slice(0, n));
  const delta = withIndicatorExpectancy - baselineExpectancy;
  let verdict: IndicatorAblation["verdict"] = "NO_USEFUL_VALUE";
  if (delta > 0.05) verdict = "ADDS_INFORMATION";
  else if (delta < -0.05) verdict = "HARMS";
  return { name: opts.name, baselineExpectancy, withIndicatorExpectancy, delta, n, verdict };
}
export function regimeSplit(returns: number[], labels: string[]): Record<string, { n: number; expectancy: number | null }> {
  const buckets: Record<string, number[]> = {};
  for (let i = 0; i < returns.length; i++) {
    const k = labels[i] ?? "unknown";
    (buckets[k] ??= []).push(returns[i]!);
  }
  const out: Record<string, { n: number; expectancy: number | null }> = {};
  for (const [k, xs] of Object.entries(buckets)) out[k] = { n: xs.length, expectancy: xs.length >= 8 ? xs.reduce((a, b) => a + b, 0) / xs.length : null };
  return out;
}
