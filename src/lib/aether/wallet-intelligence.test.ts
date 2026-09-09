import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateWalletPerformance, generateCopySignals } from "./wallet-intelligence.ts";
import type { PolymarketTrade } from "./wallet-intelligence.ts";
import type { PolymarketDTO } from "./types.ts";

function trade(opts: Partial<PolymarketTrade> & { walletId: string; timestamp: string; price: number; side: "buy" | "sell" }): PolymarketTrade {
  return {
    id: `id:${opts.timestamp}:${opts.price}`,
    walletId: opts.walletId,
    address: opts.walletId.replace("polygon:", ""),
    chainId: "polygon",
    txHash: null,
    marketId: opts.marketId ?? "m1",
    conditionId: opts.conditionId ?? "m1",
    eventSlug: null,
    marketTitle: opts.marketTitle ?? "Market 1",
    outcome: "Yes",
    side: opts.side,
    size: opts.size ?? 100,
    price: opts.price,
    notionalUsd: (opts.size ?? 100) * opts.price,
    timestamp: opts.timestamp,
    observedAt: opts.timestamp,
    source: "test",
  };
}

describe("wallet-intelligence", () => {
  it("scores winning wallet higher than losing wallet", () => {
    const base = new Date().toISOString();
    const winner = [
      trade({ walletId: "polygon:w1", timestamp: base, price: 0.4, side: "buy", marketId: "m1", conditionId: "m1", marketTitle: "Crypto ETF" }),
      trade({ walletId: "polygon:w1", timestamp: new Date(Date.now() + 5 * 60_000).toISOString(), price: 0.55, side: "sell", marketId: "m1", conditionId: "m1", marketTitle: "Crypto ETF" }),
    ];
    const loser = [
      trade({ walletId: "polygon:w2", timestamp: base, price: 0.6, side: "buy", marketId: "m2", conditionId: "m2", marketTitle: "Macro" }),
      trade({ walletId: "polygon:w2", timestamp: new Date(Date.now() + 5 * 60_000).toISOString(), price: 0.5, side: "sell", marketId: "m2", conditionId: "m2", marketTitle: "Macro" }),
    ];
    const prices = new Map<string, number>([
      ["m1", 0.55],
      ["m2", 0.5],
    ]);
    const p1 = evaluateWalletPerformance(winner, prices);
    const p2 = evaluateWalletPerformance(loser, prices);
    assert.ok(p1.realizedPnlUsd > 0);
    assert.ok(p2.realizedPnlUsd < 0);
    assert.ok(p1.qualityScore > p2.qualityScore, "winner quality should exceed loser quality");
  });

  it("generates copy signals only for quality wallets", () => {
    const base = new Date().toISOString();
    const trades = [
      trade({ walletId: "polygon:w1", timestamp: base, price: 0.4, side: "buy", marketId: "m1", conditionId: "m1", marketTitle: "Crypto ETF" }),
      trade({ walletId: "polygon:w1", timestamp: new Date(Date.now() + 5 * 60_000).toISOString(), price: 0.55, side: "sell", marketId: "m1", conditionId: "m1", marketTitle: "Crypto ETF" }),
      // recent fresh trade from a low-quality wallet (only 1 round-trip, below threshold)
      trade({ walletId: "polygon:w2", timestamp: new Date(Date.now() - 5 * 60_000).toISOString(), price: 0.6, side: "buy", marketId: "m2", conditionId: "m2", marketTitle: "Macro" }),
    ];
    const perf1 = evaluateWalletPerformance(trades.filter((t) => t.walletId === "polygon:w1"), new Map());
    const perf2 = evaluateWalletPerformance(trades.filter((t) => t.walletId === "polygon:w2"), new Map());
    const wallets = new Map([
      ["polygon:w1", perf1],
      ["polygon:w2", perf2],
    ]);
    const markets: PolymarketDTO[] = [
      {
        id: "m1",
        question: "Crypto ETF",
        slug: "crypto-etf",
        probability: 0.55,
        probabilityChange24h: 0.1,
        volume: 1_000_000,
        volume24h: 100_000,
        liquidity: 500_000,
        endDate: null,
        url: null,
        category: "crypto",
      },
      {
        id: "m2",
        question: "Macro",
        slug: "macro",
        probability: 0.5,
        probabilityChange24h: -0.05,
        volume: 500_000,
        volume24h: 50_000,
        liquidity: 200_000,
        endDate: null,
        url: null,
        category: "macro",
      },
    ];
    const assetMap = new Map<string, string>([["m1", "cg:bitcoin"]]);
    const signals = generateCopySignals({ trades, wallets, markets, assetMap });
    assert.ok(signals.every((s) => s.walletQualityScore > 0.25), "signals should only come from quality wallets");
    assert.ok(signals[0]?.copyConfidence >= 0);
  });
});
