export function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function num0(v: unknown): number {
  return num(v) ?? 0;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function tanh01(x: number): number {
  return 0.5 + 0.5 * Math.tanh(x);
}

export function log10p(n: number): number {
  return Math.log10(Math.max(0, n) + 1);
}

/** Map log10(usd) into 0..1 around [lo, hi] decades (e.g. 4 = $10k, 7 = $10m). */
export function logScale01(usd: number, lo = 3.5, hi = 7): number {
  return clamp((log10p(usd) - lo) / (hi - lo), 0, 1);
}

export function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

export function pctChange(from: number, to: number): number {
  if (!from) return 0;
  return ((to - from) / from) * 100;
}

export function sharpe(returns: number[], periodsPerYear = 365): number {
  if (returns.length < 3) return 0;
  const m = mean(returns);
  const s = stdev(returns);
  if (s === 0) return 0;
  return (m / s) * Math.sqrt(periodsPerYear);
}

export function sortino(returns: number[], periodsPerYear = 365): number {
  if (returns.length < 3) return 0;
  const m = mean(returns);
  const neg = returns.filter((r) => r < 0);
  if (!neg.length) return m > 0 ? 10 : 0;
  const ds = Math.sqrt(neg.reduce((a, r) => a + r * r, 0) / neg.length);
  if (ds === 0) return 0;
  return (m / ds) * Math.sqrt(periodsPerYear);
}

export function maxDrawdown(equity: number[]): number {
  let peak = equity[0] ?? 0;
  let maxDd = 0;
  for (const x of equity) {
    if (x > peak) peak = x;
    if (peak > 0) maxDd = Math.max(maxDd, (peak - x) / peak);
  }
  return maxDd;
}

export function seededUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

export function round(n: number, d = 8): number {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}
