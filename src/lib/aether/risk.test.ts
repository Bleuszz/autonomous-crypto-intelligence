import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessRug, checkOrderRisk } from "./risk.ts";

describe("rug assessment", () => {
  it("never claims safe — empty scan still has residual score and a caveat", () => {
    const r = assessRug({});
    assert.ok(r.score > 0);
    assert.ok(r.reasons.some((x) => /not a safety/i.test(x)));
  });

  it("raises score for honeypot + mint + unlocked lp", () => {
    const r = assessRug({
      isHoneypot: true,
      mintable: true,
      lpLocked: false,
      creatorPercent: 0.4,
    });
    assert.ok(r.score > 0.7);
  });
});

describe("order risk", () => {
  it("blocks kill switch and daily loss", () => {
    const r = checkOrderRisk({
      killSwitch: true,
      equity: 10000,
      cash: 10000,
      requestedNotional: 100,
      dayPnlUsd: 0,
      tokenNotionalAfter: 100,
      chainNotionalAfter: 100,
      liquidityUsd: 1_000_000,
      slippageBps: 10,
      limits: {
        maxPositionPct: 0.1,
        maxDailyLossPct: 0.08,
        maxTokenConcentrationPct: 0.25,
        maxChainExposurePct: 0.5,
        maxLiquidityTakePct: 0.02,
        maxSlippageBps: 150,
      },
    });
    assert.equal(r.ok, false);
  });
});
