export function fmtUsd(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `$${(n / 1e3).toFixed(1)}k`;
  if (abs >= 1) return `$${n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
  if (abs >= 0.01) return `$${n.toFixed(4)}`;
  if (abs === 0) return "$0.00";
  return `$${n.toExponential(2)}`;
}

export function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function shortAddr(addr: string | null | undefined): string {
  if (!addr) return "—";
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function signedClass(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "text-muted-foreground";
  return n > 0 ? "text-up" : "text-down";
}
