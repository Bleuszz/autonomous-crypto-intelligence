import { contextFromSparkline, evaluateTradingIntelligence } from "./engine.ts";
import { TRADING_INTEL_VERSION, type TradingIntelligence } from "./types.ts";
export type TradingIntelAssetInput = { id: string; symbol: string; priceUsd: number | null; observedAt: string | null; sparkline7d: number[] | null; volume24hUsd: number | null; liquidityUsd: number | null; fundingPct: number | null };
export type TradingIntelDashboard = { version: string; generatedAt: string; researchEquityGbp: 100000; realisticEquityGbp: 100; capitalNote: string; rows: TradingIntelligence[]; emptyReason: string | null };
export function assembleTradingIntelDashboard(opts: { assets: TradingIntelAssetInput[]; nowIso?: string }): TradingIntelDashboard {
  const generatedAt = opts.nowIso ?? new Date().toISOString();
  const rows: TradingIntelligence[] = [];
  for (const a of opts.assets.slice(0, 16)) {
    const lastCloseMs = a.observedAt ? Date.parse(a.observedAt) : Date.parse(generatedAt);
    rows.push(evaluateTradingIntelligence(contextFromSparkline({ assetId: a.id, symbol: a.symbol, sparkline7d: a.sparkline7d, lastCloseMs: Number.isFinite(lastCloseMs) ? lastCloseMs : Date.parse(generatedAt), decisionTimestamp: generatedAt, volume24hUsd: a.volume24hUsd, liquidityUsd: a.liquidityUsd, fundingPct: a.fundingPct })));
  }
  return { version: TRADING_INTEL_VERSION, generatedAt, researchEquityGbp: 100_000, realisticEquityGbp: 100, capitalNote: "£100,000 is the active paper research book. £100 is the realistic deployment gate. A strategy that only works at £100k is CAPITAL-SCALE DEPENDENT — NOT DEPLOYMENT READY.", rows, emptyReason: rows.length ? null : "NO DATA" };
}
