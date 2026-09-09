import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDigest, digestKey, londonSlot } from "./digest.ts";
import type { OverviewDTO } from "./types.ts";

function overview(): OverviewDTO {
  return {
    generatedAt: "2026-09-09T21:00:00.000Z",
    tradingMode: "PAPER",
    liveArmed: false,
    portfolio: {
      id: "paper-default",
      name: "Default paper desk",
      tradingMode: "PAPER",
      startingEquityUsd: 10_000,
      cashUsd: 8_000,
      equityUsd: 10_200,
      realizedPnlUsd: 50,
      unrealizedPnlUsd: 150,
      dayPnlUsd: 40,
      dayPnlPct: 0.4,
      maxDrawdownPct: 1.2,
      peakEquityUsd: 10_200,
      positions: [
        {
          id: "1",
          assetId: "cg:bitcoin",
          symbol: "BTC",
          name: "Bitcoin",
          qty: 0.02,
          avgPrice: 77_000,
          mark: 78_000,
          notionalUsd: 1_560,
          unrealizedPnlUsd: 20,
          unrealizedPnlPct: 1.3,
          openedAt: "2026-09-09T18:00:00.000Z",
          chainId: null,
        },
      ],
      recentFills: [],
      recentOrders: [],
      equityCurve: [],
      feesPaidUsd: 3,
      slippagePaidUsd: 1,
      nTrades: 1,
      winRate: null,
    },
    regime: {
      fearGreed: 66,
      fearGreedLabel: "Greed",
      btcChange24h: -0.4,
      ethChange24h: 0.1,
      btcDominancePct: 54,
      label: "Mixed / transitional",
    },
    opportunities: [],
    signals: [],
    news: [],
    social: [],
    polymarket: [],
    sources: [{ source: "coingecko", status: "up", latencyMs: 200, lastSuccessAt: null, lastError: null }],
    lastIngestAt: "2026-09-09T21:00:00.000Z",
    ingestStatus: "ok",
    assetCount: 1,
    scanCapacity: { majors: 100, dex: 10, ranked: 1 },
    xUsage: {
      configured: true,
      callsToday: 3,
      dailyCap: 8,
      callsWeek: 3,
      weeklyCap: 48,
      lastCallAt: null,
      lastSuccessAt: null,
      nextCallAt: null,
      lastError: null,
      tweetsPulledWeek: 10,
    },
  };
}

describe("digest", () => {
  it("labels FACT/INFERENCE and never embeds a bearer", () => {
    const d = buildDigest(overview(), "evening");
    assert.match(d.text, /FACT — portfolio/);
    assert.match(d.text, /INFERENCE/);
    assert.match(d.subject, /Aether/);
    assert.equal(d.text.toLowerCase().includes("bearer "), false);
    assert.match(d.text, /BTC/);
  });

  it("keys a london slot", () => {
    assert.equal(digestKey("morning", "2026-09-10"), "2026-09-10:morning");
  });

  it("detects 08:00 Europe/London as morning", () => {
    // 07:00 UTC is 08:00 BST in September.
    const hit = londonSlot(new Date("2026-09-10T07:02:00.000Z"));
    assert.ok(hit);
    assert.equal(hit.slot, "morning");
  });

  it("keeps section breaks and HTML-escapes titles", () => {
    const d = buildDigest(overview(), "evening");
    assert.match(d.text, /FACT — portfolio/);
    assert.match(d.text, /\n\n=== INFERENCE ===\n/);
    assert.equal(d.html.includes("<script>"), false);
    const dirty = overview();
    dirty.news = [
      {
        id: "n",
        source: "coindesk",
        sourceReliability: 0.8,
        title: "<script>alert(1)</script>",
        url: null,
        summary: null,
        entities: [],
        publishedAt: null,
        ingestedAt: null,
        freshness: "NEW",
        ageMs: 0,
      },
    ];
    const h = buildDigest(dirty, "morning");
    assert.equal(h.html.includes("<script>alert"), false);
    assert.ok(h.html.includes("\u0026lt;script\u0026gt;"));
  });
});
