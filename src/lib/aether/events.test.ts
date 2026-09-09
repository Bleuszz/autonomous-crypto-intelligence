import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectEntities, classifyEvent, computeNovelty, detectEvents, informationAdvantageScore } from "./events.ts";
import type { AssetRow, NewsDTO } from "./types.ts";

const btcAsset: AssetRow = {
  id: "cg:bitcoin",
  symbol: "BTC",
  name: "Bitcoin",
  kind: "major",
  chainId: null,
  contractAddress: null,
  coingeckoId: "bitcoin",
  imageUrl: null,
  priceUsd: 65_000,
  marketCapUsd: 1.3e12,
  fdvUsd: null,
  volume24hUsd: 35e9,
  liquidityUsd: 0,
  change1hPct: 0.2,
  change24hPct: 1.5,
  change7dPct: -2,
  pairCreatedAt: null,
  sparkline7d: [],
  source: "coingecko",
  sourceReliability: 0.9,
  observedAt: new Date().toISOString(),
  ingestedAt: new Date().toISOString(),
  dataAgeMs: 30_000,
};

describe("events", () => {
  it("detects Fed entities", () => {
    const d = detectEntities("Fed signals rate cut as inflation cools");
    assert.equal(d.entityId, "fed");
    assert.ok(d.credibility > 0.8);
  });

  it("detects SEC/ETF entities", () => {
    const d = detectEntities("SEC approves spot Ethereum ETF");
    assert.equal(d.entityId, "sec");
  });

  it("classifies regulatory and macro events", () => {
    assert.equal(classifyEvent("SEC approves ETF").eventType, "regulatory");
    assert.equal(classifyEvent("Fed raises rates").eventType, "macro");
    assert.equal(classifyEvent("Protocol drained in exploit").eventType, "security_incident");
  });

  it("novelty scores drop on repeated titles", () => {
    const existing = [{ title: "Fed holds rates steady", publishedAt: null }];
    const n1 = computeNovelty("Fed raises interest rates", existing);
    assert.ok(n1 > 0.5);
    const n2 = computeNovelty("Fed holds rates steady today", existing);
    assert.ok(n2 < n1);
  });

  it("detects events from high-confidence news", () => {
    const news: NewsDTO[] = [
      {
        id: "n1",
        source: "coindesk",
        sourceReliability: 0.85,
        title: "Fed announces surprise rate cut; Bitcoin rallies",
        url: null,
        summary: "Traders react to easier monetary policy.",
        entities: ["BTC"],
        publishedAt: new Date(Date.now() - 120_000).toISOString(),
        ingestedAt: new Date().toISOString(),
        freshness: "RECENT",
        ageMs: 120_000,
      },
    ];
    const events = detectEvents({ news, social: [], polymarket: [], assets: [btcAsset] });
    assert.ok(events.length > 0);
    const ev = events[0]!;
    assert.equal(ev.entityId, "fed");
    assert.ok(ev.confidence > 0);
    assert.ok(ev.affectedAssets.includes("BTC"));
  });

  it("rejects stale and low-confidence items", () => {
    const news: NewsDTO[] = [
      {
        id: "n2",
        source: "unknownblog",
        sourceReliability: 0.2,
        title: "Random altcoin will 100x",
        url: null,
        summary: null,
        entities: [],
        publishedAt: new Date(Date.now() - 3_600_000).toISOString(),
        ingestedAt: new Date().toISOString(),
        freshness: "STALE",
        ageMs: 3_600_000,
      },
    ];
    const events = detectEvents({ news, social: [], polymarket: [], assets: [btcAsset] });
    assert.equal(events.length, 0);
  });

  it("computes information advantage score with bounded components", () => {
    const s = informationAdvantageScore({
      eventImpact: 0.8,
      eventConfidence: 0.7,
      walletQualityScore: 0.6,
      walletConsensus: 0.5,
      timingSeconds: 120,
      freshness: "NEW",
      historicalPredictiveValue: 0.55,
    });
    assert.ok(s.total >= 0 && s.total <= 1);
    assert.ok(s.components.timing > 0.8, "short latency should score high");
  });
});
