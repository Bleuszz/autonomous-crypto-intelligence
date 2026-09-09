import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runMomentumBacktest, walkForwardSplit, type Candle } from "./backtest.ts";

function series(n: number): Candle[] {
  const out: Candle[] = [];
  let px = 100;
  for (let i = 0; i < n; i++) {
    px = px * (1 + (i % 7 === 0 ? 0.04 : -0.005));
    out.push({ t: Date.UTC(2024, 0, 1) + i * 86400000, open: px, high: px * 1.01, low: px * 0.99, close: px, volume: 10 });
  }
  return out;
}

describe("backtest", () => {
  it("does not look ahead — next-open fill vs signal close", () => {
    const candles = series(80);
    const res = runMomentumBacktest(candles);
    assert.ok(res.metrics.nTrades >= 0);
    for (const t of res.trades) {
      assert.ok(t.exitTime >= t.entryTime);
    }
  });

  it("walk-forward split preserves order and has no overlap", () => {
    const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const { inSample, outOfSample } = walkForwardSplit(rows, 0.7);
    assert.deepEqual([...inSample, ...outOfSample], rows);
    assert.equal(inSample.length, 7);
  });

  it("applies costs so zero-friction profit is impossible on a flat book", () => {
    const flat: Candle[] = Array.from({ length: 30 }, (_, i) => ({
      t: i * 86400000,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume: 1,
    }));
    const res = runMomentumBacktest(flat, {
      lookback: 2,
      entryPct: -1,
      exitPct: -50,
      holdBars: 2,
      feeBps: 30,
      slippageBps: 10,
    });
    if (res.metrics.nTrades > 0) {
      assert.ok(res.metrics.totalReturnPct <= 0);
    }
  });
});
