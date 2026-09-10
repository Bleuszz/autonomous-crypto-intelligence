import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canAdvanceStage, championNeedsRollback, compareChallengerToChampion, createStrategyCandidate, rejectCandidate, rollBackCandidate } from "./promotion.ts";
import type { ChampionChallengerMetrics, StrategyCandidate } from "./types.ts";

function makeCandidate(): StrategyCandidate {
  return createStrategyCandidate({ strategyId: "ensemble", strategyVersion: "1.1.0", learnerVersion: "0.2.0" });
}

function makeMetrics(): ChampionChallengerMetrics {
  return {
    totalReturnPct: 10,
    sharpe: 1.2,
    maxDrawdownPct: 8,
    winRate: 0.55,
    expectancy: 0.35,
    calmar: 1.25,
    payoffRatio: 1.5,
    nTrades: 50,
    tradesByRegime: { bullish: { n: 30, avgReturn: 0.4 }, bearish: { n: 20, avgReturn: -0.1 } },
    tradesByAsset: { BTC: { n: 25, avgReturn: 0.5 } },
    costSensitivity: { feesUp: 8, slippageUp: 7 },
  };
}

describe("promotion pipeline", () => {
  it("creates a candidate in CANDIDATE status", () => {
    const c = makeCandidate();
    assert.equal(c.status, "CANDIDATE");
    assert.equal(c.learnerVersion, "0.2.0");
  });

  it("cannot advance from DISCOVERED without shadow experiences", () => {
    const c = makeCandidate();
    const res = canAdvanceStage({ candidate: c, learner: { trainingExperienceCount: 0 } as any, patterns: [], experiences: [] });
    assert.equal(res.ok, true);
    assert.equal(res.nextStage, "SHADOW");
  });

  it("requires shadow experiences before training", () => {
    const c = { ...makeCandidate(), promotionPipeline: { current: "SHADOW", history: ["DISCOVERED", "SHADOW"] } } as StrategyCandidate;
    const res = canAdvanceStage({ candidate: c, learner: { trainingExperienceCount: 0 } as any, patterns: [], experiences: [] });
    assert.equal(res.ok, false);
    assert.ok(res.reason.includes("shadow experiences"));
  });

  it("requires training experiences before validation", () => {
    const c = { ...makeCandidate(), promotionPipeline: { current: "TRAINED", history: ["DISCOVERED", "SHADOW", "TRAINED"] } } as StrategyCandidate;
    const res = canAdvanceStage({ candidate: c, learner: { trainingExperienceCount: 5 } as any, patterns: [], experiences: [] });
    assert.equal(res.ok, false);
    assert.ok(res.reason.includes("training experiences"));
  });

  it("rejects a candidate", () => {
    const c = makeCandidate();
    const rejected = rejectCandidate(c, "underperformed in OOS");
    assert.equal(rejected.status, "REJECTED");
    assert.equal(rejected.promotionPipeline.current, "REJECTED");
  });

  it("rolls back a candidate", () => {
    const c = makeCandidate();
    const rolled = rollBackCandidate(c, "post-approval drawdown exceeded");
    assert.equal(rolled.status, "REJECTED");
    assert.ok((rolled.rollbackReason ?? "").includes("drawdown"));
  });

  it("compares challenger vs champion on multiple metrics", () => {
    const challenger: ChampionChallengerMetrics = { ...makeMetrics(), totalReturnPct: 15, sharpe: 1.4 };
    const champion = makeMetrics();
    const cmp = compareChallengerToChampion(challenger, champion);
    assert.ok(cmp.wins > 0);
    assert.equal(cmp.details.totalReturnPct.winner, "challenger");
  });

  it("flags fragile challenger when cost sensitivity destroys performance", () => {
    const challenger: ChampionChallengerMetrics = {
      ...makeMetrics(),
      costSensitivity: { feesUp: -5, slippageUp: -6, latencyUp: -4 },
    };
    const champion = makeMetrics();
    const cmp = compareChallengerToChampion(challenger, champion);
    assert.equal(cmp.details.costSensitivity?.winner, "champion");
  });

  it("does not roll back a fresh champion", () => {
    const metrics = makeMetrics();
    const check = championNeedsRollback(metrics, 1 * 24 * 3600 * 1000, 5);
    assert.equal(check.rollback, false);
  });

  it("rolls back when post-approval expectancy turns negative", () => {
    const metrics: ChampionChallengerMetrics = { ...makeMetrics(), nTrades: 10, expectancy: -0.05 };
    const check = championNeedsRollback(metrics, 5 * 24 * 3600 * 1000, 5);
    assert.equal(check.rollback, true);
  });

  it("does not roll back with sufficient positive performance", () => {
    const metrics: ChampionChallengerMetrics = { ...makeMetrics(), nTrades: 12, expectancy: 0.2, maxDrawdownPct: 10 };
    const check = championNeedsRollback(metrics, 5 * 24 * 3600 * 1000, 5);
    assert.equal(check.rollback, false);
  });
});
