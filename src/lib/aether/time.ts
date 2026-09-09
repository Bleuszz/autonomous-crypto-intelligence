import { NEWS_NEW_MS, NEWS_RECENT_MS } from "./config.ts";

export function nowIso(): string {
  return new Date().toISOString();
}

export function nowMs(): number {
  return Date.now();
}

export function parseTime(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") {
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function iso(v: unknown): string | null {
  const d = parseTime(v);
  return d ? d.toISOString() : null;
}

export function ageMs(observedAt: string | Date | null | undefined, now = Date.now()): number | null {
  const d = parseTime(observedAt);
  if (!d) return null;
  return Math.max(0, now - d.getTime());
}

export type FreshnessBand = "NEW" | "RECENT" | "STALE" | "UNKNOWN";

export function newsFreshness(publishedAt: string | Date | null | undefined, now = Date.now()): FreshnessBand {
  const age = ageMs(publishedAt, now);
  if (age == null) return "UNKNOWN";
  if (age <= NEWS_NEW_MS) return "NEW";
  if (age <= NEWS_RECENT_MS) return "RECENT";
  return "STALE";
}

export function freshnessScore(publishedAt: string | Date | null | undefined, now = Date.now()): number {
  const age = ageMs(publishedAt, now);
  if (age == null) return 0.2;
  const hours = age / 3_600_000;
  return Math.exp(-hours / 6);
}

export function formatAge(ms: number | null | undefined): string {
  if (ms == null) return "unknown";
  if (ms < 1000) return "now";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

export function formatUtc(isoStr: string | null | undefined): string {
  if (!isoStr) return "—";
  const d = parseTime(isoStr);
  if (!d) return "—";
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}
