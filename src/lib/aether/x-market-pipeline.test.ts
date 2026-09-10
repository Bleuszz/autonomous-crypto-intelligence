import { describe, it } from "node:test";
import assert from "node:assert";
import type { XMarketAccount } from "../../../config/x-market-watchlist.ts";
import {
  buildXMarketEvent,
  classifyXEvent,
  computeImpactScore,
  computeMarketReaction,
  eventFingerprint,
  extractAffectedEntities,
  generateSignal,
  isNoise,
  marketImpactScore,
  type MarketSnapshot,
} from "./x-market-pipeline.ts";

const TRUMP: XMarketAccount = {
  username: "realDonaldTrump",
  displayName: "Donald Trump",
  category: "us_administration",
  tier: "TIER_1",
  influenceScore: 1.0,
  assetsOfInterest: ["SPY", "QQQ", "DELL", "INTC", "NVDA", "BTC", "USD"],
  enabled: true,
};

const ANALYST: XMarketAccount = {
  username: "randomanalyst",
  displayName: "Random Analyst",
  category: "journalist",
  tier: "TIER_3",
  influenceScore: 0.5,
  assetsOfInterest: ["BTC"],
  enabled: true,
};

const SNAPS: MarketSnapshot[] = [
  { symbol: "DELL", priceUsd: 100, change24hPct: 0.5, volume24hUsd: 1_000_000 },
  { symbol: "NVDA", priceUsd: 120, change24hPct: 8.5, volume24hUsd: 5_000_000 },
  { symbol: "INTC", priceUsd: 22, change24hPct: -1.2, volume24hUsd: 800_000 },
];

const EMPTY_ASSETS: Array<{ symbol: string; name: string }> = [];

function makePost(body: string) {
  return {
    id: "123",
    postId: "123",
    username: "realDonaldTrump",
    displayName: "Donald Trump",
    body,
    url: "https://x.com/i/web/status/123",
    publishedAt: new Date(Date.now() - 2000).toISOString(),
    engagement: 50000,
  };
}

describe("x-market-pipeline noise filter", () => {
  it("flags generic social noise as irrelevant", () => {
    assert.strictEqual(isNoise("Happy birthday to my good friend!"), true);
    assert.strictEqual(isNoise("Good morning everyone, have a great day!"), true);
    assert.strictEqual(isNoise("Great meeting today with the team."), true);
    assert.strictEqual(isNoise("Check out this article I wrote."), true);
  });

  it("does not flag market-relevant posts as noise", () => {
    assert.strictEqual(isNoise("We are putting enormous tariffs on foreign chips."), false);
    assert.strictEqual(isNoise("The Fed will hold rates steady."), false);
  });
});

describe("x-market-pipeline event classification", () => {
  it("classifies tariff language", () => {
    const c = classifyXEvent("We are putting enormous tariffs on foreign chips.");
    assert.strictEqual(c.eventType, "TARIFF");
    assert.ok(c.severity > 0.8);
  });

  it("classifies fed language", () => {
    const c = classifyXEvent("The Federal Reserve is prepared to cut interest rates.");
    assert.strictEqual(c.eventType, "FED");
  });

  it("classifies generic statements as OTHER", () => {
    const c = classifyXEvent("Thanks for all the support today.");
    assert.strictEqual(c.eventType, "OTHER");
  });
});

describe("x-market-pipeline entity extraction", () => {
  it("detects direct Dell mention from Trump", () => {
    const e = extractAffectedEntities("Dell is going to build massive new plants in the USA.", TRUMP, EMPTY_ASSETS as never);
    assert.ok(e.directMention);
    assert.ok(e.assets.includes("DELL"));
    assert.ok(e.confidence > 0.85);
  });

  it("infers semiconductor exposure from tariff language", () => {
    const e = extractAffectedEntities("We are going to put enormous tariffs on foreign chips.", TRUMP, EMPTY_ASSETS as never);
    assert.ok(e.assets.includes("NVDA") || e.assets.includes("AMD") || e.assets.includes("INTC"));
    assert.ok(e.sectors.includes("semiconductors"));
  });

  it("marks indirect references with lower confidence", () => {
    const e = extractAffectedEntities("Foreign chipmakers will face tough rules.", TRUMP, EMPTY_ASSETS as never);
    assert.ok(e.inferredExposure || e.directMention || e.confidence < 0.9);
    assert.ok(e.reason.length > 0);
  });
});

describe("x-market-pipeline impact scoring", () => {
  it("gives Trump + Dell + tariff very high impact", () => {
    const post = makePost("We are putting enormous tariffs on foreign chips from Dell suppliers.");
    const event = buildXMarketEvent(post, TRUMP, EMPTY_ASSETS as never, SNAPS, [], 0, 0, new Date().toISOString());
    assert.ok(event.marketImpactScore >= 60, `impact was ${event.marketImpactScore}`);
    assert.strictEqual(event.tier, "TIER_1");
    assert.ok(event.affectedAssets.includes("DELL") || event.affectedAssets.includes("NVDA"));
  });

  it("gives random analyst + generic BTC a much lower impact", () => {
    const post = makePost("Bitcoin looks interesting today.");
    const event = buildXMarketEvent(post, ANALYST, EMPTY_ASSETS as never, SNAPS, [], 0, 0, new Date().toISOString());
    assert.ok(event.marketImpactScore < 45, `impact was ${event.marketImpactScore}`);
  });

  it("rejects noise/low-impact events", () => {
    const extraction = extractAffectedEntities("Nice weather in Washington.", TRUMP, EMPTY_ASSETS as never);
    const classification = classifyXEvent("Nice weather in Washington.");
    const novelty = 1;
    const impact = computeImpactScore(TRUMP, extraction, classification, novelty);
    assert.ok(impact < 0.35);
    const signal = generateSignal(impact, marketImpactScore(impact), computeMarketReaction([], SNAPS));
    assert.strictEqual(signal.signal, "REJECT");
  });
});

describe("x-market-pipeline market reaction", () => {
  it("detects already-priced event when 24h move is large", () => {
    const reaction = computeMarketReaction(["NVDA"], SNAPS);
    assert.strictEqual(reaction.marketReacted, true);
    assert.strictEqual(reaction.reactionStrength, "large");
  });

  it("treats flat asset as no material reaction", () => {
    const reaction = computeMarketReaction(["DELL"], SNAPS);
    assert.strictEqual(reaction.reactionStrength, "none");
    assert.strictEqual(reaction.marketReacted, false);
  });

  it("generates EARLY_PAPER_SIGNAL when high impact and no reaction", () => {
    const reaction = computeMarketReaction(["DELL"], SNAPS);
    const signal = generateSignal(0.75, 75, reaction);
    assert.strictEqual(signal.signal, "EARLY_PAPER_SIGNAL");
    assert.ok(signal.reason.includes("market reaction"));
  });

  it("generates LATE_EVENT when high impact but market moved", () => {
    const reaction = computeMarketReaction(["NVDA"], SNAPS);
    const signal = generateSignal(0.65, 65, reaction);
    assert.strictEqual(signal.signal, "LATE_EVENT");
  });
});

describe("x-market-pipeline deduplication", () => {
  it("produces identical fingerprints for duplicate posts", () => {
    const a = eventFingerprint("Tariffs on foreign chips are coming soon.");
    const b = eventFingerprint("Tariffs on foreign chips are coming soon.");
    assert.strictEqual(a, b);
  });

  it("produces different fingerprints for materially different posts", () => {
    const a = eventFingerprint("Tariffs on foreign chips are coming soon.");
    const b = eventFingerprint("The Fed will cut interest rates tomorrow.");
    assert.notStrictEqual(a, b);
  });
});

describe("x-market-pipeline latency measurement", () => {
  it("records positive latency stages", () => {
    const published = new Date(Date.now() - 5000).toISOString();
    const received = new Date(Date.now() - 3000).toISOString();
    const post = { ...makePost("Tariffs on Dell suppliers."), publishedAt: published };
    const event = buildXMarketEvent(post, TRUMP, EMPTY_ASSETS as never, SNAPS, [], 0, 0, received);
    assert.ok(event.latency.detectionLatencyMs >= 0);
    assert.ok(event.latency.totalLatencyMs >= 0);
    assert.ok(event.latency.totalLatencyMs >= event.latency.detectionLatencyMs);
  });
});

describe("x-market-pipeline cross-source confirmation", () => {
  it("boosts confidence when confirmation sources are present", () => {
    const post = makePost("Dell is expanding US manufacturing.");
    const eventConfirmed = buildXMarketEvent(post, TRUMP, EMPTY_ASSETS as never, SNAPS, [], 2, 0, new Date().toISOString());
    const eventAlone = buildXMarketEvent(post, TRUMP, EMPTY_ASSETS as never, SNAPS, [], 0, 0, new Date().toISOString());
    assert.ok(eventConfirmed.confirmationCount > eventAlone.confirmationCount);
    assert.strictEqual(eventConfirmed.eventStatus, "confirmed");
  });

  it("marks contradicted status when contradictions exceed confirmations", () => {
    const post = makePost("Dell is expanding US manufacturing.");
    const event = buildXMarketEvent(post, TRUMP, EMPTY_ASSETS as never, SNAPS, [], 1, 2, new Date().toISOString());
    assert.strictEqual(event.eventStatus, "contradicted");
  });
});
