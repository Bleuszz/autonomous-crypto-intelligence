import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import type { XMarketAccount } from "../../../config/x-market-watchlist.ts";
import {
  getStreamRules,
  setStreamRules,
  xMarketEnabled,
  xMarketMode,
  xMinImpactScore,
  xStreamLines,
} from "./x-market-stream.ts";

const TEST_BEARER = "test-bearer-token";

const ACCT_A: XMarketAccount = {
  username: "realDonaldTrump",
  displayName: "Donald Trump",
  category: "us_administration",
  tier: "TIER_1",
  influenceScore: 1.0,
  assetsOfInterest: ["SPY"],
  enabled: true,
};

const ACCT_B: XMarketAccount = {
  username: "elonmusk",
  displayName: "Elon Musk",
  category: "ceo_influencer",
  tier: "TIER_1",
  influenceScore: 0.95,
  assetsOfInterest: ["TSLA"],
  enabled: true,
};

describe("x-market-intelligence configuration", () => {
  before(() => {
    process.env.X_ENABLED = "true";
    process.env.X_MODE = "filtered_stream";
    process.env.X_MIN_IMPACT_SCORE = "55";
  });

  after(() => {
    delete process.env.X_ENABLED;
    delete process.env.X_MODE;
    delete process.env.X_MIN_IMPACT_SCORE;
  });

  it("reads enabled flag and mode", () => {
    assert.strictEqual(xMarketEnabled(), true);
    assert.strictEqual(xMarketMode(), "filtered_stream");
  });

  it("reads minimum impact score with safe fallback", () => {
    assert.strictEqual(xMinImpactScore(), 55);
    delete process.env.X_MIN_IMPACT_SCORE;
    assert.strictEqual(xMinImpactScore(), 35);
    process.env.X_MIN_IMPACT_SCORE = "55";
  });

  it("falls back to disabled when X_ENABLED is not true", () => {
    delete process.env.X_ENABLED;
    assert.strictEqual(xMarketEnabled(), false);
    assert.strictEqual(xMarketMode(), "disabled");
    process.env.X_ENABLED = "true";
  });
});

describe("x-market-intelligence stream rules", () => {
  const originalFetch = globalThis.fetch;

  after(async () => {
    globalThis.fetch = originalFetch;
  });

  it("fetches existing rules", async () => {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/rules") && url.endsWith("/rules")) {
        return {
          ok: true,
          json: async () => ({ data: [{ id: "1", value: "from:old", tag: "old" }] }),
        } as Response;
      }
      return { ok: false, status: 404, text: async () => "" } as Response;
    };
    const rules = await getStreamRules(TEST_BEARER);
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0]!.value, "from:old");
  });

  it("replaces existing rules with watchlist OR rules", async () => {
    let deleteCalled = false;
    let addBody: unknown = null;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/rules") && init?.method === "GET") {
        return {
          ok: true,
          json: async () => ({ data: [{ id: "rule-1", value: "from:old", tag: "old" }] }),
        } as Response;
      }
      if (url.endsWith("/rules") && init?.method === "POST") {
        const body = init.body ? JSON.parse(String(init.body)) : null;
        if (body?.delete) {
          deleteCalled = true;
          return { ok: true, text: async () => "{}" } as Response;
        }
        if (body?.add) {
          addBody = body;
          return { ok: true, text: async () => "{}" } as Response;
        }
      }
      return { ok: false, status: 404, text: async () => "" } as Response;
    };
    const res = await setStreamRules(TEST_BEARER, [ACCT_A, ACCT_B]);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(deleteCalled, true);
    assert.ok(Array.isArray((addBody as { add: unknown[] }).add));
    assert.ok(
      (addBody as { add: { value: string }[] }).add.some((r) => r.value.includes("from:realDonaldTrump")),
    );
  });

  it("reports failure when X auth/connection fails", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => "Unauthorized" } as Response);
    const res = await setStreamRules(TEST_BEARER, [ACCT_A]);
    assert.strictEqual(res.ok, false);
    assert.ok(res.error?.includes("401"));
  });
});

describe("x-market-intelligence NDJSON stream parsing", () => {
  it("yields parsed JSON objects from a streamed response body", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      '{"data":{"id":"t1","text":"hello world"}}\n{"data":{"id":"t2","text":"second"}}\n',
      '{"data":{"id":"t3","text":"third"}}\n',
    ];
    let i = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (i < chunks.length) {
          controller.enqueue(encoder.encode(chunks[i]));
          i++;
        } else {
          controller.close();
        }
      },
    });

    globalThis.fetch = async () =>
      ({
        ok: true,
        body,
      } as Response);

    const yielded: unknown[] = [];
    for await (const line of xStreamLines(TEST_BEARER)) {
      yielded.push(line);
    }
    assert.strictEqual(yielded.length, 3);
    assert.strictEqual((yielded[0] as { data: { id: string } }).data.id, "t1");
  });

  it("throws on non-ok stream response", async () => {
    globalThis.fetch = async () =>
      ({
        ok: false,
        status: 403,
        text: async () => "Forbidden",
      } as Response);
    await assert.rejects(() => xStreamLines(TEST_BEARER).next(), /403/);
  });
});
