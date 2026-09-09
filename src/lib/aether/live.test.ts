import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateLiveGates } from "./live.ts";

describe("live gates", () => {
  it("stays closed when only API keys exist", () => {
    const r = evaluateLiveGates(
      {
        BINANCE_API_KEY: "x",
        BINANCE_API_SECRET: "y",
      },
      { tradingMode: "PAPER", enableLiveTrading: false, killSwitch: false },
    );
    assert.equal(r.canSubmit, false);
    assert.equal(r.armed, false);
    assert.ok(r.gates.some((g) => !g.passed));
  });

  it("still refuses even if every env flag is set", () => {
    const r = evaluateLiveGates(
      {
        ENABLE_LIVE_TRADING: "true",
        TRADING_MODE: "LIVE",
        LIVE_EXECUTION_UNLOCK: "I_UNDERSTAND_THIS_SPENDS_REAL_MONEY",
        BINANCE_API_KEY: "x",
        BINANCE_API_SECRET: "y",
        GROK_PROJECT_ID: "prod",
      },
      { tradingMode: "LIVE", enableLiveTrading: true, killSwitch: false },
    );
    assert.equal(r.canSubmit, false);
    assert.ok(r.gates.some((g) => g.name === "Hard disable" || !g.passed));
  });
});
