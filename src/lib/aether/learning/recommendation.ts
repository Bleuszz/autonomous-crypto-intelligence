import type { DecisionAction, LearnerRecommendation } from "./types.ts";

const ACTIONS = new Set<DecisionAction>(["ENTER", "WAIT", "REJECT", "EXIT"]);

export function jsonbField<T>(value: unknown): T | null {
  if (value == null) return null;
  try {
    const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
    if (parsed == null) return null;
    return parsed as T;
  } catch {
    return null;
  }
}

export function parseLearnerRecommendation(raw: unknown): LearnerRecommendation | null {
  const obj = jsonbField<Record<string, unknown>>(raw);
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const actionRaw = obj.action;
  if (typeof actionRaw !== "string" || !ACTIONS.has(actionRaw as DecisionAction)) return null;
  const expectedReward = typeof obj.expectedReward === "number" && Number.isFinite(obj.expectedReward) ? obj.expectedReward : 0;
  const confidence = typeof obj.confidence === "number" && Number.isFinite(obj.confidence) ? obj.confidence : 0;
  const reasons = Array.isArray(obj.reasons) ? obj.reasons.filter((r): r is string => typeof r === "string") : ["NO DATA"];
  return {
    action: actionRaw as DecisionAction,
    expectedReward,
    confidence,
    reasons: reasons.length ? reasons : ["NO DATA"],
  };
}

export function coerceLearnerRecommendation(raw: unknown): LearnerRecommendation {
  return (
    parseLearnerRecommendation(raw) ?? {
      action: "WAIT",
      expectedReward: 0,
      confidence: 0,
      reasons: ["NO DATA"],
    }
  );
}

export function predictionStatus(opts: {
  resolved: boolean;
  recommendation: LearnerRecommendation | null;
}): "UNRESOLVED" | "NO DATA" | "OK" {
  if (!opts.recommendation) return "NO DATA";
  if (!opts.resolved) return "UNRESOLVED";
  return "OK";
}
