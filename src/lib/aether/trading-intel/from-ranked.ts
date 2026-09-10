import type { TradingIntelAssetInput } from "./dashboard.ts";

type LooseAsset = {
  id?: string;
  symbol?: string;
  priceUsd?: number | null;
  observedAt?: string | null;
  sparkline7d?: number[] | null;
  volume24hUsd?: number | null;
  liquidityUsd?: number | null;
};

type LooseRanked = {
  asset?: LooseAsset;
  id?: string;
  symbol?: string;
};

export function assetsFromRanked(rows: LooseRanked[] | null | undefined): TradingIntelAssetInput[] {
  if (!rows?.length) return [];
  const out: TradingIntelAssetInput[] = [];
  for (const row of rows) {
    const a: LooseAsset = row.asset ?? row;
    if (!a || typeof a !== "object") continue;
    const id = typeof a.id === "string" ? a.id : null;
    const symbol = typeof a.symbol === "string" ? a.symbol : null;
    if (!id || !symbol) continue;
    out.push({
      id,
      symbol,
      priceUsd: typeof a.priceUsd === "number" ? a.priceUsd : null,
      observedAt: typeof a.observedAt === "string" ? a.observedAt : null,
      sparkline7d: Array.isArray(a.sparkline7d) ? a.sparkline7d.filter((n): n is number => typeof n === "number") : null,
      volume24hUsd: typeof a.volume24hUsd === "number" ? a.volume24hUsd : null,
      liquidityUsd: typeof a.liquidityUsd === "number" ? a.liquidityUsd : null,
      fundingPct: null,
    });
  }
  return out;
}
