/**
 * Survivorship-bias protection. Dead, delisted, rugged and illiquid assets
 * stay in the historical set. Never silently delete them.
 */

export type AssetLifecycleState = "ACTIVE" | "ILLIQUID" | "DELISTED" | "FAILED" | "RUGGED" | "UNKNOWN";

export type LifecycleInput = {
  lastObservedAt: number | null;
  priceUsd: number | null;
  liquidityUsd?: number | null;
  volume24hUsd?: number | null;
  nowMs?: number;
  explicit?: AssetLifecycleState | null;
  rugRisk?: number | null;
  delistedHint?: boolean;
};

export type LifecycleRecord = {
  state: AssetLifecycleState;
  reason: string;
  retainHistory: true;
};

const ILLIQUID_USD = 8_000;
const DEAD_MS = 14 * 24 * 3600_000;

export function classifyLifecycle(input: LifecycleInput): LifecycleRecord {
  if (input.explicit) {
    return { state: input.explicit, reason: `Explicit state ${input.explicit}`, retainHistory: true };
  }
  if (input.delistedHint) {
    return { state: "DELISTED", reason: "Delist hint from venue or news.", retainHistory: true };
  }
  if ((input.rugRisk ?? 0) >= 0.75) {
    return { state: "RUGGED", reason: "Rug-risk score above 0.75.", retainHistory: true };
  }
  const now = input.nowMs ?? Date.now();
  if (input.lastObservedAt != null && now - input.lastObservedAt > DEAD_MS) {
    if ((input.priceUsd ?? 0) > 0 && (input.priceUsd ?? 1) < 1e-8) {
      return { state: "FAILED", reason: "No observations for 14d and price effectively zero.", retainHistory: true };
    }
    return { state: "UNKNOWN", reason: "No observations for 14d. History retained.", retainHistory: true };
  }
  if ((input.priceUsd ?? 1) > 0 && (input.priceUsd ?? 1) < 1e-9) {
    return { state: "FAILED", reason: "Price effectively zero.", retainHistory: true };
  }
  const liq = input.liquidityUsd ?? 0;
  const vol = input.volume24hUsd ?? 0;
  if (liq > 0 && liq < ILLIQUID_USD && vol < ILLIQUID_USD) {
    return { state: "ILLIQUID", reason: "Liquidity and volume below executable thresholds.", retainHistory: true };
  }
  if (input.priceUsd && input.priceUsd > 0) {
    return { state: "ACTIVE", reason: "Recently observed with a positive mark.", retainHistory: true };
  }
  return { state: "UNKNOWN", reason: "Insufficient fields to classify. History retained.", retainHistory: true };
}

export function survivorshipNote(states: AssetLifecycleState[]): string {
  const dead = states.filter((s) => s !== "ACTIVE").length;
  if (!states.length) return "INSUFFICIENT EVIDENCE";
  if (dead === 0) {
    return "WARNING: historical set contains only ACTIVE assets. Survivorship bias risk.";
  }
  return `Retained ${dead} non-active assets of ${states.length} (illiquid/delisted/failed/rugged/unknown).`;
}
