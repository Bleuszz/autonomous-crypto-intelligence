import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  getLearnerControlAudit,
  getLearnerHealth,
  getLearnerOperatingState,
  getLearnerPassword,
  getLearnerPredictionStats,
  loadLearnerPredictions,
  parseLearnerRecommendation,
  setLearnerOperatingState,
} from "./controls.ts";
import type { LearnerActionStats, LearnerPredictionStats } from "./types.ts";
import type { Sql } from "@/lib/db";

class MockSql {
  queries: Array<{ text: string; params: unknown[] }> = [];
  private nextResults: unknown[][] = [];

  push(...results: unknown[][]) {
    this.nextResults.push(...results);
  }

  query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> => {
    this.queries.push({ text, params });
    const res = this.nextResults.shift() ?? [];
    return res as T[];
  };

  tagged = async <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> => {
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return this.query<T>(text, values);
  };

  sql = Object.assign(this.tagged, { query: this.query }) as unknown as Sql;
}

let mockSql: MockSql;

beforeEach(() => {
  mockSql = new MockSql();
  delete process.env.LEARNING_CONTROL_PASSWORD;
});

function stateRow(mode: string, updatedAt: string | null = null) {
  return [{ value: { mode }, updated_at: updatedAt }];
}

function predictionRow(opts: {
  id: string;
  assetId?: string;
  symbol?: string;
  actionAt?: string;
  learnerVersion?: string;
  decision?: string;
  baselineAction?: string | null;
  regime?: string;
  recommendation?: { action: string; confidence: number; expectedReward: number; reasons: string[] };
  totalReward?: number | null;
  realizedReturnPct?: number | null;
}) {
  return {
    id: opts.id,
    asset_id: opts.assetId ?? "cg:bitcoin",
    symbol: opts.symbol ?? "BTC",
    action_at: opts.actionAt ?? "2026-01-01T00:00:00Z",
    learner_version: opts.learnerVersion ?? "v1",
    decision: opts.decision ?? "ENTER",
    baseline_action: opts.baselineAction ?? "ENTER",
    regime: opts.regime ?? '{"label":"Strong Bull"}',
    learner_recommendation: JSON.stringify(
      opts.recommendation ?? { action: "ENTER", confidence: 0.75, expectedReward: 1.2, reasons: [] },
    ),
    total_reward: opts.totalReward ?? null,
    realized_return_pct: opts.realizedReturnPct ?? null,
  };
}

describe("learner password", () => {
  it("falls back to the documented local default when no env var is set", () => {
    delete process.env.LEARNING_CONTROL_PASSWORD;
    assert.equal(getLearnerPassword(), "1234");
  });

  it("reads the server-side environment variable when present", () => {
    process.env.LEARNING_CONTROL_PASSWORD = "env-secret";
    assert.equal(getLearnerPassword(), "env-secret");
  });
});

describe("learner operating state", () => {
  it("defaults to SHADOW when no persisted state exists", async () => {
    mockSql.push([]);
    const state = await getLearnerOperatingState(mockSql.sql);
    assert.equal(state.mode, "SHADOW");
    assert.equal(state.updatedAt, null);
  });

  it("reads the persisted mode from system_config", async () => {
    mockSql.push(stateRow("ACTIVE", "2026-01-02T00:00:00Z"));
    const state = await getLearnerOperatingState(mockSql.sql);
    assert.equal(state.mode, "ACTIVE");
    assert.equal(state.updatedAt, "2026-01-02T00:00:00Z");
  });

  it("changes state with the correct password", async () => {
    mockSql.push(stateRow("SHADOW"));
    const result = await setLearnerOperatingState(mockSql.sql, {
      requestedMode: "ACTIVE",
      password: "1234",
      clientContext: { source: "test" },
    });
    assert.equal(result.ok, true);
    assert.equal(result.mode, "ACTIVE");

    const updates = mockSql.queries.filter((q) => q.text.includes("insert into system_config"));
    assert.ok(updates.length > 0, "state should be persisted");

    const audits = mockSql.queries.filter((q) => q.text.includes("learner_control_audit"));
    assert.ok(audits.length > 0, "audit row should be written");
    const auditParams = audits[0].params;
    assert.ok(!auditParams.some((p) => typeof p === "string" && p.includes("1234")), "password must not be logged");
  });

  it("rejects an incorrect password and makes no change", async () => {
    mockSql.push(stateRow("SHADOW"));
    const result = await setLearnerOperatingState(mockSql.sql, {
      requestedMode: "ACTIVE",
      password: "wrong",
      clientContext: { source: "test" },
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "Incorrect password");
    assert.equal(result.mode, "SHADOW");

    const updates = mockSql.queries.filter((q) => q.text.includes("insert into system_config"));
    assert.equal(updates.length, 0, "no state change should occur");

    const audits = mockSql.queries.filter((q) => q.text.includes("learner_control_audit"));
    assert.ok(audits.length > 0, "failed attempt should be audited");
    const auditParams = audits[0].params;
    assert.ok(!auditParams.some((p) => typeof p === "string" && p.includes("wrong")), "password must not be logged");
  });

  it("rejects a missing password", async () => {
    mockSql.push(stateRow("SHADOW"));
    const result = await setLearnerOperatingState(mockSql.sql, {
      requestedMode: "ACTIVE",
      password: "",
      clientContext: { source: "test" },
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "Incorrect password");
    assert.equal(result.mode, "SHADOW");
  });

  it("treats a repeated same-mode request as a no-op success", async () => {
    mockSql.push(stateRow("SHADOW"));
    const result = await setLearnerOperatingState(mockSql.sql, {
      requestedMode: "SHADOW",
      password: "1234",
      clientContext: { source: "test" },
    });
    assert.equal(result.ok, true);
    assert.equal(result.mode, "SHADOW");

    const updates = mockSql.queries.filter((q) => q.text.includes("insert into system_config"));
    assert.equal(updates.length, 0, "no update needed for no-op");
  });
});

describe("learner audit log", () => {
  it("returns parsed audit rows", async () => {
    mockSql.push([
      {
        id: "a1",
        changed_at: "2026-01-01T00:00:00Z",
        previous_state: "SHADOW",
        new_state: "ACTIVE",
        action: "ENABLE_ACTIVE",
        success: true,
        reason: "Mode changed from SHADOW to ACTIVE",
        client_context: '{"source":"web_dashboard"}',
      },
    ]);
    const rows = await getLearnerControlAudit(mockSql.sql, 10);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, "ENABLE_ACTIVE");
    assert.equal(rows[0].success, true);
    assert.deepEqual(rows[0].clientContext, { source: "web_dashboard" });
  });
});

describe("learner predictions and statistics", () => {
  it("returns empty statistics when no predictions exist", async () => {
    mockSql.push([]);
    const stats = await getLearnerPredictionStats(mockSql.sql);
    assert.equal(stats.totalPredictions, 0);
    assert.equal(stats.resolvedPredictions, 0);
    assert.equal(stats.unresolvedPredictions, 0);
    assert.equal(stats.overallAccuracy, null);
    assert.equal(stats.cumulativeReward, 0);
    assert.equal(stats.baselineComparison.insufficientEvidence, true);
  });

  it("counts unresolved predictions", async () => {
    mockSql.push([predictionRow({ id: "p1" }), predictionRow({ id: "p2" })]);
    const stats = await getLearnerPredictionStats(mockSql.sql);
    assert.equal(stats.totalPredictions, 2);
    assert.equal(stats.resolvedPredictions, 0);
    assert.equal(stats.unresolvedPredictions, 2);
    assert.equal(stats.overallAccuracy, null);
  });

  it("marks an ENTER prediction correct when reward is positive", async () => {
    mockSql.push([
      predictionRow({
        id: "p1",
        recommendation: { action: "ENTER", confidence: 0.8, expectedReward: 1.5, reasons: [] },
        totalReward: 2,
      }),
    ]);
    const stats = await getLearnerPredictionStats(mockSql.sql);
    assert.equal(stats.resolvedPredictions, 1);
    assert.equal(stats.correctPredictions, 1);
    assert.equal(stats.incorrectPredictions, 0);
    assert.equal(stats.overallAccuracy, 1);
  });

  it("marks a REJECT prediction correct when reward is negative", async () => {
    mockSql.push([
      predictionRow({
        id: "p1",
        decision: "REJECT",
        baselineAction: "ENTER",
        recommendation: { action: "REJECT", confidence: 0.7, expectedReward: -0.5, reasons: [] },
        totalReward: -1.5,
      }),
    ]);
    const stats = await getLearnerPredictionStats(mockSql.sql);
    assert.equal(stats.correctPredictions, 1);
    assert.equal(stats.overallAccuracy, 1);
  });

  it("marks an ENTER prediction incorrect when reward is negative", async () => {
    mockSql.push([
      predictionRow({
        id: "p1",
        recommendation: { action: "ENTER", confidence: 0.8, expectedReward: 1.5, reasons: [] },
        totalReward: -2,
      }),
    ]);
    const stats = await getLearnerPredictionStats(mockSql.sql);
    assert.equal(stats.correctPredictions, 0);
    assert.equal(stats.incorrectPredictions, 1);
    assert.equal(stats.overallAccuracy, 0);
  });

  it("breaks accuracy down by action", async () => {
    mockSql.push([
      predictionRow({
        id: "p1",
        recommendation: { action: "ENTER", confidence: 0.8, expectedReward: 1, reasons: [] },
        totalReward: 1,
      }),
      predictionRow({
        id: "p2",
        decision: "REJECT",
        baselineAction: "ENTER",
        recommendation: { action: "REJECT", confidence: 0.6, expectedReward: -0.2, reasons: [] },
        totalReward: -1,
      }),
      predictionRow({
        id: "p3",
        decision: "WAIT",
        baselineAction: "ENTER",
        recommendation: { action: "WAIT", confidence: 0.5, expectedReward: 0.1, reasons: [] },
        totalReward: 0.5,
      }),
    ]);
    const stats = await getLearnerPredictionStats(mockSql.sql);
    const enter = stats.byAction.find((a: LearnerActionStats) => a.action === "ENTER");
    const reject = stats.byAction.find((a: LearnerActionStats) => a.action === "REJECT");
    assert.ok(enter);
    assert.ok(reject);
    assert.equal(enter?.accuracy, 1);
    assert.equal(reject?.accuracy, 1);
  });

  it("bucketizes predictions by confidence", async () => {
    mockSql.push([
      predictionRow({
        id: "p1",
        recommendation: { action: "ENTER", confidence: 0.85, expectedReward: 1, reasons: [] },
        totalReward: 1,
      }),
      predictionRow({
        id: "p2",
        recommendation: { action: "ENTER", confidence: 0.3, expectedReward: 1, reasons: [] },
        totalReward: -1,
      }),
    ]);
    const stats = await getLearnerPredictionStats(mockSql.sql);
    const high = stats.byConfidence.find((b: LearnerPredictionStats["byConfidence"][number]) => b.bucket === "80–100%");
    const low = stats.byConfidence.find((b: LearnerPredictionStats["byConfidence"][number]) => b.bucket === "20–40%");
    assert.ok(high);
    assert.ok(low);
    assert.equal(high?.predictions, 1);
    assert.equal(high?.accuracy, 1);
    assert.equal(low?.accuracy, 0);
  });

  it("compares learner predictions against the deterministic baseline", async () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      predictionRow({
        id: `p${i}`,
        decision: "ENTER",
        baselineAction: "ENTER",
        recommendation: { action: "ENTER", confidence: 0.8, expectedReward: 1, reasons: [] },
        totalReward: i < 4 ? 2 : -1,
      }),
    );
    mockSql.push(rows);
    const stats = await getLearnerPredictionStats(mockSql.sql);
    const bc = stats.baselineComparison;
    assert.equal(bc.insufficientEvidence, false);
    assert.equal(bc.baselinePredictions, 6);
    assert.equal(bc.learnerPredictions, 6);
    assert.equal(bc.agreement, 6);
    assert.equal(bc.disagreement, 0);
    assert.ok(bc.baselineAccuracy !== null);
    assert.ok(bc.learnerAccuracy !== null);
  });
});

describe("learner health", () => {
  it("warns when no decision snapshots exist", async () => {
    mockSql.push([{ count: 0, latest: null }]);
    mockSql.push([{ total: 0, unresolved: 0, oldest_unresolved: null }]);
    mockSql.push([{ count: 0 }]);
    const health = await getLearnerHealth(mockSql.sql);
    assert.equal(health.experienceIngestion, "WARNING");
    assert.ok(health.diagnostics.some((d: string) => d.includes("No decision snapshots")));
  });

  it("warns when most predictions lack outcomes", async () => {
    mockSql.push([{ count: 10, latest: new Date().toISOString() }]);
    mockSql.push([{ total: 10, unresolved: 6, oldest_unresolved: new Date().toISOString() }]);
    mockSql.push([{ count: 0 }]);
    const health = await getLearnerHealth(mockSql.sql);
    assert.equal(health.outcomeResolution, "WARNING");
    assert.ok(health.diagnostics.some((d: string) => d.includes("unresolved")));
  });
});

describe("loadLearnerPredictions", () => {
  it("parses regime labels", async () => {
    mockSql.push([
      predictionRow({
        id: "p1",
        regime: '{"label":"Weak Bear"}',
        recommendation: { action: "ENTER", confidence: 0.6, expectedReward: 0.5, reasons: [] },
      }),
    ]);
    const preds = await loadLearnerPredictions(mockSql.sql, 10);
    assert.equal(preds.length, 1);
    assert.equal(preds[0].regime, "Weak Bear");
    assert.equal(preds[0].resolved, false);
  });

  it("falls back to null when the regime payload has no label", async () => {
    mockSql.push([
      predictionRow({
        id: "p1",
        regime: "{}",
        recommendation: { action: "ENTER", confidence: 0.6, expectedReward: 0.5, reasons: [] },
      }),
    ]);
    const preds = await loadLearnerPredictions(mockSql.sql, 10);
    assert.equal(preds[0].regime, null);
  });

  it("skips JSON null, malformed, and incomplete legacy recommendations", async () => {
    const valid = predictionRow({ id: "valid" });
    mockSql.push([
      { ...predictionRow({ id: "json-null" }), learner_recommendation: "null" },
      { ...predictionRow({ id: "malformed" }), learner_recommendation: "{" },
      { ...predictionRow({ id: "missing-action" }), learner_recommendation: '{"confidence":0.6,"expectedReward":0.2}' },
      valid,
    ]);
    const preds = await loadLearnerPredictions(mockSql.sql, 10);
    assert.deepEqual(preds.map((p) => p.snapshotId), ["valid"]);
  });

  it("normalizes optional recommendation reasons", () => {
    assert.deepEqual(
      parseLearnerRecommendation({ action: "WAIT", confidence: 0.4, expectedReward: 0.1 }),
      { action: "WAIT", confidence: 0.4, expectedReward: 0.1, reasons: [] },
    );
    assert.equal(parseLearnerRecommendation({ action: null, confidence: 0.4, expectedReward: 0.1 }), null);
  });
});

describe("learner dashboard composition", () => {
  it("exposes the dashboard type expected by the UI", () => {
    // The dashboard is assembled from server-side functions that accept a Sql
    // handle. This test verifies the exported shape is present for the route.
    assert.ok(getLearnerOperatingState);
    assert.ok(getLearnerPredictionStats);
    assert.ok(getLearnerHealth);
    assert.ok(getLearnerControlAudit);
  });
});
