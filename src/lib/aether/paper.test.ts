import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { simulateFill, positionSizeUsd } from "./paper.ts";

describe("paper fills", () => {
  it("does not fill at the signal mid for a buy", () => {
    const fill = simulateFill({
      side: "buy",
      mid: 100,
      notionalUsd: 1000,
      liquidityUsd: 200_000,
      volatilityPct: 5,
      latencyMs: 4000,
      seed: "unit-buy",
    });
    assert.equal(fill.ok, true);
    assert.notEqual(fill.price, 100);
    assert.ok(fill.price > 100, "buy should pay impact");
    assert.ok(fill.feeUsd > 0);
  });

  it("rejects empty books", () => {
    const fill = simulateFill({
      side: "buy",
      mid: 1,
      notionalUsd: 100,
      liquidityUsd: 100,
      volatilityPct: 1,
      latencyMs: 1000,
      seed: "thin",
    });
    assert.equal(fill.ok, false);
  });

  it("caps size by liquidity take", () => {
    const size = positionSizeUsd(10_000, 0.9, 0.1, 50_000, 0.02);
    assert.ok(size <= 1000);
    assert.ok(size <= 50_000 * 0.02 + 1e-6);
  });
});
