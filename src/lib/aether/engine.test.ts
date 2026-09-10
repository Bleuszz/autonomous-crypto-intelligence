import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideEntries,
  decideExits,
  isQualityPaperEntry,
  sparkFeat,
  type RegimeInput,
} from "./engine.ts";
import type { RankedOpportunity } from "./types.ts";

function opp(p: Partial<RankedOpportunity["asset"]> & { id?: string; symbol?: string; kind?: "major" | "dex" } = {}): RankedOpportunity {
  const id = p.id ?? "cg:bitcoin";
  const symbol = p.symbol ?? "BTC";
  return {
    asset: {
      id,
      symbol,
      name: symbol,
      kind: p.kind ?? "major",
      chainId: null,
      contractAddress: null,
      coingeckoId: "bitcoin",
      imageUrl: null,
      priceUsd: p.priceUsd ?? 78000,
      marketCapUsd: p.marketCapUsd ?? 1_500_000_000_000,
      fdvUsd: null,
      volume24hUsd: p.volume24hUsd ?? 20_000_000_000,
      liquidityUsd: p.liquidityUsd ?? 20_000_000_000,
      change1hPct: p.change1hPct ?? 0.5,
      change24hPct: p.change24hPct ?? -3,
      change7dPct: p.change7dPct ?? 1,
      pairCreatedAt: null,
      sparkline7d: p.sparkline7d ?? [100, 99, 98, 97, 96, 97, 98, 99],
      source: "coingecko",
      sourceReliability: 0.88,
      observedAt: new Date().toISOString(),
      ingestedAt: new Date().toISOString(),
      dataAgeMs: 5_000,
    },
    score: 0.62,
    confidence: 0.66,
    rugRisk: 0.08,
    components: {
      marketQuality: 0.8,
      liquidity: 0.9,
      momentum: 0.6,
      volumeAnomaly: 0.4,
      smartMoney: 0.1,
      social: 0.1,
      news: 0.1,
      riskPenalty: 0.08,
      executionPenalty: 0,
    },
    reasons: ["Established market"],
    riskReasons: [],
  };
}

const mixed: RegimeInput = { fearGreed: 55, btcChange24h: -0.4, ethChange24h: -0.2, btcFundingPct: 0.002, label: "Mixed" };

describe("paper engine", () => {
  it("dip-buys a liquid major that is down on the day but turning 1h", () => {
    const r = opp({ change24hPct: -3.2, change1hPct: 0.4 });
    const intents = decideEntries({ ranked: [r], signals: [], held: new Set(), regime: mixed, openCount: 0 });
    assert.ok(intents.some((i) => i.side === "buy" && i.assetId === "cg:bitcoin"), JSON.stringify(intents));
  });

  it("refuses social_proxy as an auto entry", () => {
    const r = opp();
    assert.equal(isQualityPaperEntry(r, { strategyId: "social_proxy_v1", confidence: 0.9 }), false);
  });

  it("blocks entries when data quality flags a fake move", () => {
    const r = opp();
    r.dataQuality = {
      score: 22,
      sourceConflict: true,
      delayed: false,
      stale: false,
      fakeMoveSuspected: true,
      blockEntry: true,
      flags: ["unconfirmed_vertical_print"],
    };
    assert.equal(isQualityPaperEntry(r, { strategyId: "momentum_v2", confidence: 0.8 }), false);
  });

  it("stops out a position that is down past the major stop", () => {
    const r = opp({ priceUsd: 100 });
    const exits = decideExits({
      positions: [{ id: "p", assetId: r.asset.id, qty: 1, avgPrice: 110, openedAt: new Date(Date.now() - 3600_000).toISOString(), peakMark: 110 }],
      ranked: [r],
      signals: [],
      regime: mixed,
    });
    assert.ok(exits.some((e) => e.side === "sell" && /stop/i.test(e.strategyId)));
  });

  it("opens a BTC core sleeve when the book is empty in mixed regime", () => {
    const r = opp({ change24hPct: -0.4, change1hPct: 0.1 });
    const intents = decideEntries({ ranked: [r], signals: [], held: new Set(), regime: mixed, openCount: 0 });
    assert.ok(intents.some((i) => i.strategyId === "core_beta_v2" && i.assetId === "cg:bitcoin"), JSON.stringify(intents));
  });

  it("computes spark rising/falling", () => {
    const up = sparkFeat([10, 10.1, 10.2, 10.3, 10.4, 10.6, 10.8, 11, 11.2, 11.4, 11.6, 11.8]);
    assert.ok(up);
    assert.equal(up.rising, true);
  });

  it("refuses DEX entries when mempool is congested", () => {
    const dex = opp({
      id: "dex:pepe",
      symbol: "PEPE",
      kind: "dex",
      priceUsd: 0.00001,
      marketCapUsd: 400_000_000,
      volume24hUsd: 5_000_000,
      liquidityUsd: 2_000_000,
      change24hPct: 4,
      change1hPct: 1.2,
    });
    const intents = decideEntries({
      ranked: [dex],
      signals: [
        {
          id: "s",
          strategyId: "momentum_v2",
          strategyVersion: "2.0.0",
          assetId: dex.asset.id,
          symbol: "PEPE",
          name: "PEPE",
          side: "buy",
          confidence: 0.7,
          opportunityScore: 0.6,
          status: "open",
          entryMid: dex.asset.priceUsd,
          expectedHorizon: "hours",
          createdAt: new Date().toISOString(),
          explanation: ["test"],
        },
      ],
      held: new Set(),
      regime: { ...mixed, mempoolFastSatVb: 90 },
      openCount: 2,
    });
    assert.equal(intents.some((i) => i.assetId === dex.asset.id), false);
  });

  it("cuts alts when DXY is bid", () => {
    const r = opp({ id: "cg:kaspa", symbol: "KAS", priceUsd: 0.1, change24hPct: -1 });
    const exits = decideExits({
      positions: [{ id: "p", assetId: r.asset.id, qty: 1000, avgPrice: 0.1, openedAt: new Date(Date.now() - 3600_000).toISOString(), peakMark: 0.1 }],
      ranked: [r],
      signals: [],
      regime: { ...mixed, dxyChangePct: 0.9 },
    });
    assert.ok(exits.some((e) => e.strategyId === "exit_macro_v2"));
  });
});
