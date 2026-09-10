import { DATA_QUALITY_MIN_LEARNING_WEIGHT } from "../data-quality.ts";
import type { CapitalProfileId } from "../capital.ts";
import type { DecisionAction } from "./types.ts";
import type { AssetLifecycleState } from "./survivorship.ts";

export type DatasetSplit = "TRAINING" | "VALIDATION" | "OOS" | "WALK_FORWARD" | "PAPER_CANARY";

export type TrainingExperience = {
  id: string;
  capitalProfile: CapitalProfileId;
  startingEquityGbp: number;
  availableEquityGbp: number;
  positionSizeGbp: number | null;
  portfolioExposurePct: number;
  capitalUtilisationPct: number;
  regime: string;
  asset: string;
  assetClass: string;
  marketStructure: string;
  signalType: string;
  dataQuality: number;
  sourceConflict: boolean;
  eventClusterId: string | null;
  decisionTimestamp: string;
  latestMarketDataTimestamp: string | null;
  latestNewsTimestamp: string | null;
  latestSocialTimestamp: string | null;
  latestEventTimestamp: string | null;
  analysisTimestamp: string;
  decision: DecisionAction;
  confidence: number | null;
  executableAt100: boolean;
  minimumRequiredCapitalGbp: number | null;
  capitalSensitivity: "CAPITAL-INDEPENDENT" | "CAPITAL-SENSITIVE" | "CAPITAL-DEPENDENT" | "UNKNOWN";
  outcome: string;
  reward: number | null;
  learningWeight: number;
  split: DatasetSplit;
  usedForTraining: boolean;
  correlationGroup: string | null;
  lookaheadClean: boolean;
  negativeExample: boolean;
  historicalReplay: boolean;
  assetState: AssetLifecycleState;
};

export type DiversityAxis =
  | "asset"
  | "regime"
  | "volatility"
  | "eventType"
  | "marketStructure"
  | "decision"
  | "capitalProfile";

export function assignSplit(decisionTimestampMs: number, range: { start: number; end: number }): DatasetSplit {
  const span = Math.max(1, range.end - range.start);
  const pos = (decisionTimestampMs - range.start) / span;
  if (pos < 0.55) return "TRAINING";
  if (pos < 0.7) return "VALIDATION";
  if (pos < 0.85) return "OOS";
  return "WALK_FORWARD";
}

export function shouldTrainOn(exp: TrainingExperience): { ok: boolean; reason: string } {
  if (!exp.lookaheadClean) return { ok: false, reason: "Look-ahead contamination — excluded." };
  if (exp.split !== "TRAINING") return { ok: false, reason: `Split ${exp.split} is held out of training.` };
  if (exp.learningWeight < DATA_QUALITY_MIN_LEARNING_WEIGHT) {
    return { ok: false, reason: "Data quality too low for training weight." };
  }
  return { ok: true, reason: "Eligible." };
}

export function correlationGroup(symbol: string, regime: string): string {
  const s = symbol.toUpperCase();
  if (/BTC|XBT/.test(s)) return `btc:${regime}`;
  if (/ETH/.test(s)) return `eth:${regime}`;
  return `alt:${regime}`;
}

export function correlationAdjustedCount(experiences: Array<{ correlationGroup: string | null }>): number {
  const groups = new Map<string, number>();
  for (const e of experiences) {
    const g = e.correlationGroup ?? "ungrouped";
    groups.set(g, (groups.get(g) ?? 0) + 1);
  }
  let adj = 0;
  for (const n of groups.values()) {
    adj += Math.min(n, 1 + Math.log2(n));
  }
  return adj;
}

export function diversityReport(experiences: TrainingExperience[]): {
  total: number;
  uniqueAssets: number;
  uniqueRegimes: number;
  independent: number;
  enter: number;
  wait: number;
  reject: number;
  negative: number;
  historical: number;
  live: number;
  lowQuality: number;
  sourceConflictRate: number;
  duplicateRate: number;
} {
  const assets = new Set(experiences.map((e) => e.asset));
  const regimes = new Set(experiences.map((e) => e.regime));
  const enter = experiences.filter((e) => e.decision === "ENTER").length;
  const wait = experiences.filter((e) => e.decision === "WAIT").length;
  const reject = experiences.filter((e) => e.decision === "REJECT").length;
  const negative = experiences.filter((e) => e.negativeExample).length;
  const historical = experiences.filter((e) => e.historicalReplay).length;
  const lowQuality = experiences.filter((e) => e.dataQuality < 40).length;
  const conflicts = experiences.filter((e) => e.sourceConflict).length;
  const keys = experiences.map((e) => `${e.asset}|${e.decisionTimestamp}|${e.decision}|${e.signalType}`);
  const uniqueKeys = new Set(keys);
  const duplicateRate = keys.length ? 1 - uniqueKeys.size / keys.length : 0;
  return {
    total: experiences.length,
    uniqueAssets: assets.size,
    uniqueRegimes: regimes.size,
    independent: correlationAdjustedCount(experiences),
    enter,
    wait,
    reject,
    negative,
    historical,
    live: experiences.length - historical,
    lowQuality,
    sourceConflictRate: experiences.length ? conflicts / experiences.length : 0,
    duplicateRate,
  };
}

export function qualityWeight(score0to100: number, sourceConflict: boolean, fakeMove: boolean): number {
  let w = score0to100 / 100;
  if (sourceConflict) w *= 0.7;
  if (fakeMove) w *= 0.4;
  return Math.max(0, w);
}
