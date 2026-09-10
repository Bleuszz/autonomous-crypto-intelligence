import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CAPITAL_SCALES_GBP,
  REALISTIC_EQUITY_GBP,
  RESEARCH_EQUITY_GBP,
  REALISTIC_PROFILE,
  RESEARCH_PROFILE,
  classifyCapitalSensitivity,
  gbpToUsd,
  isExecutableAtGbp,
  simulateCapitalAwareFill,
  sizeForProfile,
  summariseScale,
  type FxQuote,
  type ScaleTrade,
} from "./capital.ts";

const fx: FxQuote = { gbpUsd: 1.27, observedAt: new Date().toISOString(), source: "test" };

describe("capital profiles", () => {
  it("keeps research and realistic profiles distinct", () => {
    assert.equal(RESEARCH_PROFILE.equityGbp, RESEARCH_EQUITY_GBP);
    assert.equal(REALISTIC_PROFILE.equityGbp, REALISTIC_EQUITY_GBP);
    assert.equal(RESEARCH_EQUITY_GBP, 100_000);
    assert.equal(REALISTIC_EQUITY_GBP, 100);
  });

  it("does not invent an FX rate", () => {
    const miss = gbpToUsd(100, null);
    assert.equal(miss.usd, null);
    assert.match(miss.reason ?? "", /DATA UNAVAILABLE/);
    const hit = gbpToUsd(100, fx);
    assert.equal(hit.usd, 127);
  });

  it("sizes research tickets inside 1-3% and liquidity caps", () => {
    const s = sizeForProfile({
      profile: RESEARCH_PROFILE,
      equityGbp: 100_000,
      cashGbp: 80_000,
      confidence: 0.8,
      liquidityUsd: 50_000_000,
      volume24hUsd: 1_000_000_000,
      fx,
    });
    assert.equal(s.ok, true);
    assert.ok(s.tradePct >= 0.01 && s.tradePct <= 0.03 + 1e-9);
    assert.ok((s.notionalUsd ?? 0) < 50_000_000 * 0.02);
  });

  it("rejects a £100 ticket that cannot clear min order at 1-3%", () => {
    const s = sizeForProfile({
      profile: REALISTIC_PROFILE,
      equityGbp: 100,
      cashGbp: 100,
      confidence: 0.4,
      liquidityUsd: 5_000_000,
      volume24hUsd: 100_000_000,
      fx,
    });
    // 3% of £100 = £3, min order £8 → reject rather than secretly size up
    assert.equal(s.ok, false);
    assert.match(s.rejectReason ?? "", /min order|practically/i);
  });

  it("refuses giant fills versus live volume", () => {
    const fill = simulateCapitalAwareFill({
      profile: RESEARCH_PROFILE,
      notionalUsd: 50_000,
      volume24hUsd: 200_000,
      fill: {
        side: "buy",
        mid: 1,
        liquidityUsd: 5_000_000,
        volatilityPct: 5,
        latencyMs: 2000,
        seed: "giant",
      },
    });
    assert.equal(fill.ok, false);
    assert.match(fill.rejectReason ?? "", /volume/i);
  });

  it("classifies a strategy that only works at £100k as CAPITAL-DEPENDENT", () => {
    const mk = (equityGbp: number, n: number, rejected: number): ScaleTrade[] => {
      const trades: ScaleTrade[] = [];
      for (let i = 0; i < n; i++) trades.push({ returnPct: 1, pnlGbp: 10, feesGbp: 0.1, slippageBps: 8, notionalGbp: equityGbp * 0.02, rejected: false });
      for (let i = 0; i < rejected; i++) trades.push({ returnPct: 0, pnlGbp: 0, feesGbp: 0, slippageBps: 0, notionalGbp: 0, rejected: true });
      return trades;
    };
    const reports = CAPITAL_SCALES_GBP.map((g) =>
      summariseScale(g, g === 100_000 ? mk(g, 20, 0) : mk(g, 0, 10)),
    );
    const cls = classifyCapitalSensitivity(reports);
    assert.equal(cls.classification, "CAPITAL-DEPENDENT");
    assert.match(cls.reason, /NOT DEPLOYMENT READY/);
  });

  it("marks £100 as not executable when 3% is below min order", () => {
    const r = isExecutableAtGbp(100, {
      confidence: 0.5,
      liquidityUsd: 1_000_000,
      volume24hUsd: 10_000_000,
      fx,
    });
    assert.equal(r.ok, false);
  });

  it("does not let a £100 book inherit £100k ticket sizes", () => {
    const big = sizeForProfile({
      profile: RESEARCH_PROFILE,
      equityGbp: 100_000,
      cashGbp: 80_000,
      confidence: 0.8,
      liquidityUsd: 50_000_000,
      volume24hUsd: 1_000_000_000,
      fx,
    });
    const small = sizeForProfile({
      profile: REALISTIC_PROFILE,
      equityGbp: 100,
      cashGbp: 100,
      confidence: 0.8,
      liquidityUsd: 50_000_000,
      volume24hUsd: 1_000_000_000,
      fx,
    });
    assert.equal(big.ok, true);
    assert.ok((big.notionalGbp ?? 0) > 500);
    assert.ok((small.notionalGbp ?? 0) < (big.notionalGbp ?? 0) / 50);
  });

  it("shrinks size as volatility rises", () => {
    const calm = sizeForProfile({
      profile: RESEARCH_PROFILE,
      equityGbp: 100_000,
      cashGbp: 80_000,
      confidence: 0.8,
      liquidityUsd: 50_000_000,
      volume24hUsd: 1_000_000_000,
      fx,
      volatilityPct: 1,
      historicalReliability: 1,
    });
    const wild = sizeForProfile({
      profile: RESEARCH_PROFILE,
      equityGbp: 100_000,
      cashGbp: 80_000,
      confidence: 0.8,
      liquidityUsd: 50_000_000,
      volume24hUsd: 1_000_000_000,
      fx,
      volatilityPct: 20,
      historicalReliability: 1,
    });
    assert.equal(calm.ok, true);
    assert.equal(wild.ok, true);
    assert.ok(wild.notionalGbp < calm.notionalGbp);
  });
});
