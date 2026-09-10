import { timingSafeEqual } from "node:crypto";
import type { Sql } from "@/lib/db";
import { nowIso } from "../time.ts";
import { num0 } from "../math.ts";
import { rid } from "./snapshots.ts";
import { MIN_PATTERN_SAMPLES } from "./patterns.ts";
import type {
  DecisionAction,
  LearnerActionStats,
  LearnerAssetStats,
  LearnerBaselineComparison,
  LearnerConfidenceBucket,
  LearnerControlAudit,
  LearnerHealth,
  LearnerHealthStatus,
  LearnerOperatingMode,
  LearnerOperatingState,
  LearnerPrediction,
  LearnerPredictionStats,
  LearnerRecommendation,
  LearnerRegimeStats,
  LearnerTimePoint,
  SerializableRecord,
} from "./types.ts";

function constantTimeCompare(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function getLearnerPassword(): string {
  // Server-side only. The UI never receives this value. For this local/private
  // application a documented default is accepted when no env var is set.
  const env = typeof process !== "undefined" ? process.env.LEARNING_CONTROL_PASSWORD : undefined;
  return env && env.length > 0 ? env : "1234";
}

export async function getLearnerOperatingState(sql: Sql): Promise<LearnerOperatingState> {
  const rows = await sql.query<{ value: unknown; updated_at: string | null }>(
    `select value, updated_at from system_config where key = 'learner_operating_state'`,
  );
  const row = rows[0];
  if (!row) return { mode: "SHADOW", updatedAt: null };
  const value = row.value;
  const mode =
    value && typeof value === "object" && !Array.isArray(value) && "mode" in value && typeof value.mode === "string"
      ? (value.mode as LearnerOperatingMode)
      : "SHADOW";
  return { mode, updatedAt: row.updated_at };
}

function validateModeTransition(from: LearnerOperatingMode, to: LearnerOperatingMode): { ok: boolean; action: string } {
  const actions: Record<string, string> = {
    "DISABLED->SHADOW": "ENABLE_SHADOW",
    "DISABLED->ACTIVE": "ENABLE_ACTIVE",
    "SHADOW->DISABLED": "DISABLE",
    "SHADOW->ACTIVE": "ENABLE_ACTIVE",
    "ACTIVE->DISABLED": "DISABLE",
    "ACTIVE->SHADOW": "SET_SHADOW",
  };
  if (from === to) return { ok: true, action: "NO_CHANGE" };
  const action = actions[`${from}->${to}`];
  if (!action) return { ok: false, action: "INVALID" };
  return { ok: true, action };
}

export async function setLearnerOperatingState(
  sql: Sql,
  opts: {
    requestedMode: LearnerOperatingMode;
    password: string;
    clientContext?: SerializableRecord;
  },
): Promise<{ ok: boolean; mode: LearnerOperatingMode; error?: string; audit?: LearnerControlAudit }> {
  const current = await getLearnerOperatingState(sql);
  const transition = validateModeTransition(current.mode, opts.requestedMode);

  // Always verify the password before any state change (including no-op).
  const expected = getLearnerPassword();
  const passwordOk = constantTimeCompare(opts.password, expected);

  if (!passwordOk) {
    const audit = await recordLearnerControlAudit(sql, {
      previousState: current.mode,
      newState: current.mode,
      action: transition.action,
      success: false,
      reason: "Incorrect password",
      clientContext: opts.clientContext ?? {},
    });
    return { ok: false, mode: current.mode, error: "Incorrect password", audit };
  }

  if (current.mode === opts.requestedMode) {
    const audit = await recordLearnerControlAudit(sql, {
      previousState: current.mode,
      newState: current.mode,
      action: "NO_CHANGE",
      success: true,
      reason: "Requested mode matches current mode",
      clientContext: opts.clientContext ?? {},
    });
    return { ok: true, mode: current.mode, audit };
  }

  if (!transition.ok) {
    const audit = await recordLearnerControlAudit(sql, {
      previousState: current.mode,
      newState: opts.requestedMode,
      action: transition.action,
      success: false,
      reason: "Invalid mode transition",
      clientContext: opts.clientContext ?? {},
    });
    return { ok: false, mode: current.mode, error: "Invalid mode transition", audit };
  }

  await sql.query(
    `insert into system_config (key, value, updated_at)
       values ('learner_operating_state', $1::jsonb, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [JSON.stringify({ mode: opts.requestedMode })],
  );

  const audit = await recordLearnerControlAudit(sql, {
    previousState: current.mode,
    newState: opts.requestedMode,
    action: transition.action,
    success: true,
    reason: `Mode changed from ${current.mode} to ${opts.requestedMode}`,
    clientContext: opts.clientContext ?? {},
  });

  return { ok: true, mode: opts.requestedMode, audit };
}

export async function recordLearnerControlAudit(
  sql: Sql,
  opts: {
    previousState: LearnerOperatingMode;
    newState: LearnerOperatingMode;
    action: string;
    success: boolean;
    reason?: string;
    clientContext?: SerializableRecord;
  },
): Promise<LearnerControlAudit> {
  const id = rid();
  const clientContext = opts.clientContext ?? {};
  await sql.query(
    `insert into learner_control_audit (id, previous_state, new_state, action, success, reason, client_context)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [id, opts.previousState, opts.newState, opts.action, opts.success, opts.reason ?? null, JSON.stringify(clientContext)],
  );
  return {
    id,
    changedAt: nowIso(),
    previousState: opts.previousState,
    newState: opts.newState,
    action: opts.action,
    success: opts.success,
    reason: opts.reason ?? null,
    clientContext,
  };
}

export async function getLearnerControlAudit(sql: Sql, limit = 50): Promise<LearnerControlAudit[]> {
  const rows = await sql.query<{
    id: string;
    changed_at: string;
    previous_state: string;
    new_state: string;
    action: string;
    success: boolean;
    reason: string | null;
    client_context: string;
  }>(
    `select id, changed_at, previous_state, new_state, action, success, reason, client_context
       from learner_control_audit order by changed_at desc limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    changedAt: r.changed_at,
    previousState: r.previous_state as LearnerOperatingMode,
    newState: r.new_state as LearnerOperatingMode,
    action: r.action,
    success: r.success,
    reason: r.reason,
    clientContext: (jsonbField<SerializableRecord>(r.client_context) ?? {}) as SerializableRecord,
  }));
}

type RawPredictionRow = {
  id: string;
  asset_id: string;
  symbol: string;
  action_at: string;
  learner_version: string;
  decision: string;
  baseline_action: string | null;
  regime: string;
  learner_recommendation: string;
  total_reward: number | null;
  realized_return_pct: number | null;
};

export async function loadLearnerPredictions(sql: Sql, limit = 500): Promise<LearnerPrediction[]> {
  const rows = await sql.query<RawPredictionRow>(
    `select s.id, s.asset_id, s.symbol, s.action_at, s.learner_version, s.decision,
            s.baseline_action, s.regime, s.learner_recommendation,
            r.total_reward, o.realized_return_pct
     from trade_decision_snapshots s
     left join trade_rewards r on r.decision_snapshot_id = s.id
     left join trade_outcomes o on o.decision_snapshot_id = s.id
     where s.learner_recommendation is not null
     order by s.action_at desc
     limit $1`,
    [limit],
  );

  return rows.map((r) => {
    const rec = jsonbField<LearnerRecommendation>(r.learner_recommendation)!;
    const predicted = rec.action;
    const baseline = (r.baseline_action ?? r.decision) as DecisionAction;
    const actualReward = r.total_reward ?? null;
    const resolved = actualReward !== null;
    const correct = resolved ? predictionCorrect(predicted, actualReward) : null;
    const regimeObj = safeParseRegime(r.regime);
    return {
      snapshotId: r.id,
      assetId: r.asset_id,
      symbol: r.symbol,
      actionAt: r.action_at,
      learnerVersion: r.learner_version,
      baselineAction: baseline,
      predictedAction: predicted,
      confidence: rec.confidence,
      expectedReward: rec.expectedReward,
      actualReward,
      actualReturnPct: r.realized_return_pct ?? null,
      correct,
      resolved,
      regime: typeof regimeObj.label === "string" ? regimeObj.label : null,
    };
  });
}

export function jsonbField<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

function safeParseRegime(regime: unknown): Record<string, unknown> {
  if (regime == null) return {};
  try {
    return jsonbField<Record<string, unknown>>(regime) ?? {};
  } catch {
    return {};
  }
}

function predictionCorrect(predicted: DecisionAction, reward: number): boolean {
  const predictedPositive = predicted === "ENTER" || predicted === "WAIT";
  return (predictedPositive && reward > 0) || (predicted === "REJECT" && reward < 0);
}

function bucketLabel(confidence: number): string {
  const pct = Math.round(confidence * 100);
  if (pct < 20) return "0–20%";
  if (pct < 40) return "20–40%";
  if (pct < 60) return "40–60%";
  if (pct < 80) return "60–80%";
  return "80–100%";
}

function avg(arr: number[]): number | null {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function median(arr: number[]): number | null {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function variance(arr: number[]): number | null {
  const m = avg(arr);
  if (m == null) return null;
  return arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length;
}

export function buildLearnerPredictionStats(predictions: LearnerPrediction[]): LearnerPredictionStats {
  const resolved = predictions.filter((p) => p.resolved);
  const rewards = resolved.map((p) => p.actualReward!);
  const correctCount = resolved.filter((p) => p.correct).length;
  const positiveCount = rewards.filter((r) => r > 0).length;
  const negativeCount = rewards.filter((r) => r < 0).length;

  const byActionMap = new Map<DecisionAction, LearnerActionStats>();
  for (const p of predictions) {
    const s = byActionMap.get(p.predictedAction) ?? {
      action: p.predictedAction,
      predictions: 0,
      resolved: 0,
      correct: 0,
      incorrect: 0,
      accuracy: null,
      avgConfidence: null,
      avgReward: null,
    };
    s.predictions++;
    if (p.resolved) {
      s.resolved++;
      if (p.correct) s.correct++;
      else s.incorrect++;
    }
    byActionMap.set(p.predictedAction, s);
  }
  const byAction = Array.from(byActionMap.values()).map((s) => ({
    ...s,
    accuracy: s.resolved ? s.correct / s.resolved : null,
    avgConfidence: avg(predictions.filter((p) => p.predictedAction === s.action).map((p) => p.confidence)),
    avgReward: avg(resolved.filter((p) => p.predictedAction === s.action).map((p) => p.actualReward!)),
  }));

  const byConfidenceMap = new Map<string, LearnerConfidenceBucket>();
  for (const p of predictions) {
    const bucket = bucketLabel(p.confidence);
    const s = byConfidenceMap.get(bucket) ?? {
      bucket,
      predictions: 0,
      resolved: 0,
      accuracy: null,
      avgReward: null,
      avgConfidence: 0,
    };
    s.predictions++;
    s.avgConfidence += p.confidence;
    if (p.resolved) {
      s.resolved++;
    }
    byConfidenceMap.set(bucket, s);
  }
  const byConfidence = Array.from(byConfidenceMap.values()).map((s) => {
    const res = resolved.filter((p) => bucketLabel(p.confidence) === s.bucket);
    return {
      ...s,
      avgConfidence: s.predictions ? s.avgConfidence / s.predictions : 0,
      accuracy: res.length ? res.filter((p) => p.correct).length / res.length : null,
      avgReward: avg(res.map((p) => p.actualReward!)),
    };
  });

  const byRegimeMap = new Map<string, LearnerRegimeStats>();
  for (const p of predictions) {
    const regime = p.regime ?? "unknown";
    const s = byRegimeMap.get(regime) ?? { regime, predictions: 0, resolved: 0, accuracy: null, avgReward: null };
    s.predictions++;
    if (p.resolved) s.resolved++;
    byRegimeMap.set(regime, s);
  }
  const byRegime = Array.from(byRegimeMap.values()).map((s) => {
    const res = resolved.filter((p) => (p.regime ?? "unknown") === s.regime);
    return { ...s, accuracy: res.length ? res.filter((p) => p.correct).length / res.length : null, avgReward: avg(res.map((p) => p.actualReward!)) };
  });

  const byAssetMap = new Map<string, LearnerAssetStats>();
  for (const p of predictions) {
    const s = byAssetMap.get(p.assetId) ?? { assetId: p.assetId, symbol: p.symbol, predictions: 0, resolved: 0, accuracy: null, avgReward: null };
    s.predictions++;
    if (p.resolved) s.resolved++;
    byAssetMap.set(p.assetId, s);
  }
  const byAsset = Array.from(byAssetMap.values()).map((s) => {
    const res = resolved.filter((p) => p.assetId === s.assetId);
    return { ...s, accuracy: res.length ? res.filter((p) => p.correct).length / res.length : null, avgReward: avg(res.map((p) => p.actualReward!)) };
  });

  const timeMap = new Map<string, LearnerPrediction[]>();
  for (const p of predictions) {
    const day = p.actionAt.slice(0, 10);
    const arr = timeMap.get(day) ?? [];
    arr.push(p);
    timeMap.set(day, arr);
  }
  const sortedDays = Array.from(timeMap.keys()).sort();
  let cumulative = 0;
  const timeSeries: LearnerTimePoint[] = [];
  for (const day of sortedDays) {
    const ps = timeMap.get(day)!;
    const res = ps.filter((p) => p.resolved);
    const dayRewards = res.map((p) => p.actualReward!);
    const dayReward = dayRewards.reduce((a, b) => a + b, 0);
    cumulative += dayReward;
    timeSeries.push({
      t: day,
      accuracy: res.length ? res.filter((p) => p.correct).length / res.length : null,
      avgReward: dayRewards.length ? dayReward / dayRewards.length : null,
      cumulativeReward: cumulative,
      volume: ps.length,
    });
  }

  // Baseline comparison. Baseline action is stored on the snapshot. In the
  // current entry flow the baseline for buy-side intents is ENTER; learner
  // predictions are evaluated against the actual outcome of that baseline.
  const baselineRows = predictions.filter((p) => p.baselineAction === "ENTER");
  const baselineResolved = baselineRows.filter((p) => p.resolved);
  const baselineCorrect = baselineResolved.filter((p) => (p.actualReward ?? 0) > 0);
  const learnerPositive = predictions.filter((p) => p.predictedAction === "ENTER");
  const learnerResolved = learnerPositive.filter((p) => p.resolved);
  const learnerCorrect = learnerResolved.filter((p) => p.correct);
  const agreement = predictions.filter((p) => p.predictedAction === p.baselineAction).length;
  const disagreement = predictions.length - agreement;
  const disagreementBaselineRows = baselineResolved.filter((p) => p.predictedAction !== p.baselineAction);
  const insufficientEvidence = predictions.length < 5 || baselineResolved.length < 5 || learnerResolved.length < 5;

  const baselineComparison: LearnerBaselineComparison = {
    baselinePredictions: baselineRows.length,
    baselineResolved: baselineResolved.length,
    baselineAccuracy: baselineResolved.length ? baselineCorrect.length / baselineResolved.length : null,
    baselineAvgReward: avg(baselineResolved.map((p) => p.actualReward!)),
    learnerPredictions: learnerPositive.length,
    learnerResolved: learnerResolved.length,
    learnerAccuracy: learnerResolved.length ? learnerCorrect.length / learnerResolved.length : null,
    learnerAvgReward: avg(learnerResolved.map((p) => p.actualReward!)),
    agreement,
    disagreement,
    disagreementAvgBaselineReward: disagreementBaselineRows.length ? avg(disagreementBaselineRows.map((p) => p.actualReward!)) : null,
    insufficientEvidence,
  };

  return {
    totalPredictions: predictions.length,
    resolvedPredictions: resolved.length,
    unresolvedPredictions: predictions.length - resolved.length,
    correctPredictions: correctCount,
    incorrectPredictions: resolved.length - correctCount,
    overallAccuracy: resolved.length ? correctCount / resolved.length : null,
    avgReward: avg(rewards),
    medianReward: median(rewards),
    rewardVariance: variance(rewards),
    positiveRewardRate: rewards.length ? positiveCount / rewards.length : null,
    negativeRewardRate: rewards.length ? negativeCount / rewards.length : null,
    cumulativeReward: rewards.reduce((a, b) => a + b, 0),
    byAction,
    byConfidence,
    byRegime,
    byAsset,
    rewardByAction: byAction.map((a) => ({ action: a.action, avgReward: a.avgReward, count: a.predictions })),
    rewardByConfidence: byConfidence.map((c) => ({ bucket: c.bucket, avgReward: c.avgReward, count: c.predictions })),
    timeSeries,
    baselineComparison,
  };
}

export async function getLearnerPredictionStats(sql: Sql): Promise<LearnerPredictionStats> {
  const predictions = await loadLearnerPredictions(sql, 5000);
  return buildLearnerPredictionStats(predictions);
}

export async function getLearnerRecentPredictions(sql: Sql, limit = 50): Promise<LearnerPrediction[]> {
  return loadLearnerPredictions(sql, limit);
}

export async function getLearnerHealth(sql: Sql): Promise<LearnerHealth> {
  const diagnostics: string[] = [];

  const expRows = await sql.query<{ count: number; latest: string | null }>(
    `select count(*) as count, max(action_at) as latest from trade_decision_snapshots`,
  );
  const experienceCount = num0(expRows[0]?.count);
  const latestExperience = expRows[0]?.latest;

  let experienceIngestion: LearnerHealthStatus = "HEALTHY";
  if (!experienceCount) {
    experienceIngestion = "WARNING";
    diagnostics.push("No decision snapshots recorded yet.");
  } else if (latestExperience) {
    const hoursAgo = (Date.now() - new Date(latestExperience).getTime()) / 3600_000;
    if (hoursAgo > 24) {
      experienceIngestion = "WARNING";
      diagnostics.push(`Latest snapshot is ${Math.round(hoursAgo)} hours old.`);
    }
  }

  const predRows = await sql.query<{ total: number; unresolved: number; oldest_unresolved: string | null }>(
    `select
       count(*) as total,
       count(*) filter (where r.id is null) as unresolved,
       min(s.action_at) filter (where r.id is null) as oldest_unresolved
     from trade_decision_snapshots s
     left join trade_rewards r on r.decision_snapshot_id = s.id
     where s.learner_recommendation is not null`,
  );
  const totalPredictions = num0(predRows[0]?.total);
  const unresolved = num0(predRows[0]?.unresolved);
  let outcomeResolution: LearnerHealthStatus = "HEALTHY";
  if (totalPredictions && unresolved / totalPredictions > 0.5) {
    outcomeResolution = "WARNING";
    diagnostics.push(`${unresolved}/${totalPredictions} predictions are still unresolved.`);
  }

  const patternRows = await sql.query<{ count: number }>(`select count(*) as count from discovered_patterns`);
  const patternCount = num0(patternRows[0]?.count);
  let patternDiscovery: LearnerHealthStatus = "HEALTHY";
  if (experienceCount >= MIN_PATTERN_SAMPLES && patternCount === 0) {
    patternDiscovery = "WARNING";
    diagnostics.push(`${experienceCount} experiences but no patterns discovered.`);
  }

  let learnerEvaluation: LearnerHealthStatus = "HEALTHY";
  if (totalPredictions === 0 && experienceCount > 0) {
    learnerEvaluation = "WARNING";
    diagnostics.push("Experiences exist but no learner predictions have been recorded (learner may be DISABLED).");
  }

  let predictionResolutionLag: string | null = null;
  if (unresolved > 0 && predRows[0]?.oldest_unresolved) {
    const hours = Math.round((Date.now() - new Date(predRows[0].oldest_unresolved).getTime()) / 3600_000);
    predictionResolutionLag = `${hours}h (oldest unresolved)`;
  }

  let dataFreshness: string | null = null;
  if (latestExperience) {
    const hours = Math.round((Date.now() - new Date(latestExperience).getTime()) / 3600_000);
    dataFreshness = `${hours}h ago`;
  }

  return {
    experienceIngestion,
    outcomeResolution,
    patternDiscovery,
    learnerEvaluation,
    predictionResolutionLag,
    dataFreshness,
    diagnostics,
  };
}
