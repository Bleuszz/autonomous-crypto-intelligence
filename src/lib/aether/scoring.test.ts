import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssetRow } from "./types.ts";
import { scoreOpportunity, volumeLiquidityRatio } from "./scoring.ts";

function asset(p: Partial<AssetRow> = {}): AssetRow {
  return {
    id: "t",
    symbol: "AAA",
    name: "Aaa",
    kind: "dex",
    chainId: "base",
    contractAddress: "0x1",
    coingeckoId: null,
    imageUrl: null,
    priceUsd: 1,
    marketCapUsd: 2_000_000,
    fdvUsd: 2_000_000,
    volume24hUsd: 200_000,
    liquidityUsd: 150_000,
    change1hPct: 2,
    change24hPct: 8,
    change7dPct: 12,
    pairCreatedAt: new Date().toISOString(),
    sparkline7d: [1, 1.1, 1.2],
    source: "test",
    sourceReliability: 0.7,
    observedAt: new Date().toISOString(),
    ingestedAt: new Date().toISOString(),
    dataAgeMs: 1000,
    ...p,
  };
}

describe("scoring", () => {
  it("does not rank a +500% illiquid token above a liquid modest mover", () => {
    const illiquid = scoreOpportunity({
      asset: asset({ change24hPct: 500, liquidityUsd: 800, volume24hUsd: 50_000, marketCapUsd: 20_000 }),
      rugRisk: 0.4,
      riskReasons: [],
      smartMoney: 0,
      social: 0.2,
      news: 0,
    });
    const liquid = scoreOpportunity({
      asset: asset({ change24hPct: 12, liquidityUsd: 2_000_000, volume24hUsd: 4_000_000, kind: "major", coingeckoId: "aaa" }),
      rugRisk: 0.1,
      riskReasons: [],
      smartMoney: 0.2,
      social: 0.1,
      news: 0.2,
    });
    assert.ok(liquid.score > illiquid.score, `expected liquid ${liquid.score} > illiquid ${illiquid.score}`);
  });

  it("penalises stretched volume/liquidity", () => {
    assert.ok(volumeLiquidityRatio(1_000_000, 10_000) > 10);
    const wash = scoreOpportunity({
      asset: asset({ volume24hUsd: 5_000_000, liquidityUsd: 20_000 }),
      rugRisk: 0.2,
      riskReasons: [],
      smartMoney: 0,
      social: 0,
      news: 0,
    });
    assert.ok(wash.reasons.some((r) => /wash/i.test(r) || /stretched/i.test(r) || /Thin/i.test(r)));
  });

  it("applies risk penalty", () => {
    const clean = scoreOpportunity({
      asset: asset(),
      rugRisk: 0.1,
      riskReasons: [],
      smartMoney: 0,
      social: 0,
      news: 0,
    });
    const dirty = scoreOpportunity({
      asset: asset(),
      rugRisk: 0.9,
      riskReasons: ["honeypot"],
      smartMoney: 0,
      social: 0,
      news: 0,
    });
    assert.ok(clean.score > dirty.score);
  });
});
