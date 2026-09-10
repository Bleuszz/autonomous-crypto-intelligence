import type { CapitalClassification, ScaleReport } from "../capital.ts";
import { classifyCapitalSensitivity } from "../capital.ts";
import { canAdvanceStage, type PromotionResult } from "./promotion.ts";
import type { DiscoveredPattern, LearnerVersion, StrategyCandidate, DecisionSnapshot, TradeReward } from "./types.ts";

export type DeploymentGate = {
  ready: boolean;
  label: "DEPLOYMENT CANDIDATE" | "NOT DEPLOYMENT READY" | "INSUFFICIENT EVIDENCE";
  classification: CapitalClassification | "UNKNOWN";
  at100: ScaleReport | null;
  at100k: ScaleReport | null;
  reasons: string[];
};

export function pound100Gate(reports: ScaleReport[]): DeploymentGate {
  const at100 = reports.find((r) => r.equityGbp === 100) ?? null;
  const at100k = reports.find((r) => r.equityGbp === 100_000) ?? null;
  if (!at100) {
    return {
      ready: false,
      label: "INSUFFICIENT EVIDENCE",
      classification: "UNKNOWN",
      at100,
      at100k,
      reasons: ["No £100 scale report. £100k results cannot override this gap."],
    };
  }
  const cls = classifyCapitalSensitivity(reports);
  const reasons = [cls.reason];
  if (at100.nTrades === 0) {
    reasons.push("Would this strategy still behave sensibly if the user only had £100? No — it cannot place tickets.");
    return {
      ready: false,
      label: "NOT DEPLOYMENT READY",
      classification: cls.classification,
      at100,
      at100k,
      reasons,
    };
  }
  if (cls.classification === "CAPITAL-DEPENDENT") {
    reasons.push("£100k research performance must not override the £100 finding.");
    return {
      ready: false,
      label: "NOT DEPLOYMENT READY",
      classification: cls.classification,
      at100,
      at100k,
      reasons,
    };
  }
  if (at100.nTrades < 8) {
    return {
      ready: false,
      label: "INSUFFICIENT EVIDENCE",
      classification: cls.classification,
      at100,
      at100k,
      reasons: [...reasons, `Only ${at100.nTrades} executable £100 trades. Need ≥ 8.`],
    };
  }
  if ((at100.expectancy ?? 0) < 0 || (at100.maxDrawdownPct ?? 0) > 25) {
    reasons.push("£100 expectancy negative or drawdown > 25%.");
    return {
      ready: false,
      label: "NOT DEPLOYMENT READY",
      classification: cls.classification,
      at100,
      at100k,
      reasons,
    };
  }
  return {
    ready: true,
    label: "DEPLOYMENT CANDIDATE",
    classification: cls.classification,
    at100,
    at100k,
    reasons: ["Passes the £100 realistic-capital gate. Still paper-only; not live."],
  };
}

export function canApproveForPaper(opts: {
  candidate: StrategyCandidate;
  learner: LearnerVersion;
  patterns: DiscoveredPattern[];
  experiences: Array<{ snapshot: DecisionSnapshot; reward: TradeReward; validationStatus: string }>;
  scaleReports: ScaleReport[];
  uniqueDays: number;
}): PromotionResult & { gate: DeploymentGate } {
  const base = canAdvanceStage(opts);
  const gate = pound100Gate(opts.scaleReports);
  if (opts.uniqueDays < 5) {
    return {
      ok: false,
      reason: "Do not promote from one good day. Need ≥ 5 distinct sessions.",
      nextStage: opts.candidate.promotionPipeline.current,
      gate,
    };
  }
  if (!gate.ready) {
    return {
      ok: false,
      reason: gate.reasons[0] ?? "£100 gate failed.",
      nextStage: opts.candidate.promotionPipeline.current,
      gate,
    };
  }
  if (opts.candidate.promotionPipeline.current === "PAPER-CANARY" && !base.ok) {
    return { ...base, gate };
  }
  return { ...base, gate };
}
