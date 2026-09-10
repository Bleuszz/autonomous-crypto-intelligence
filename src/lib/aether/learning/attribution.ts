import { clamp, num0 } from "../math.ts";
import { rid } from "./snapshots.ts";
import type { Contribution, DecisionSnapshot, FeatureAttribution, TradeOutcome, TradeReward } from "./types.ts";

type FeatureRule = {
  name: string;
  // Return a contribution and a numeric weight in [-1, 1]. Higher absolute = stronger.
  score: (snapshot: DecisionSnapshot, outcome: TradeOutcome) => { contribution: Contribution; weight: number; evidence: string };
};

function contributionFromScore(score: number, name: string): { contribution: Contribution; weight: number; evidence: string } {
  const s = clamp(score, -1, 1);
  let contribution: Contribution;
  if (s >= 0.45) contribution = "STRONGLY_POSITIVE";
  else if (s >= 0.15) contribution = "POSITIVE";
  else if (s <= -0.45) contribution = "STRONGLY_NEGATIVE";
  else if (s <= -0.15) contribution = "NEGATIVE";
  else contribution = "NEUTRAL";
  return { contribution, weight: s, evidence: `${name} score ${s.toFixed(2)} at decision time` };
}

const RULES: FeatureRule[] = [
  {
    name: "Momentum",
    score: (s, o) => {
      const m = s.features.momentum;
      const dir = s.side === "buy" ? 1 : -1;
      const worked = dir * o.realizedReturnPct > 0;
      const score = m > 0.6 ? (worked ? 0.35 : -0.25) : m < 0.35 ? -0.1 : 0;
      return {
        contribution: score >= 0.25 ? "POSITIVE" : score <= -0.15 ? "NEGATIVE" : "NEUTRAL",
        weight: score,
        evidence: `Momentum ${m.toFixed(2)}; realized return ${o.realizedReturnPct.toFixed(2)}%`,
      };
    },
  },
  {
    name: "HTF trend",
    score: (s, o) => {
      const trend = s.marketStructure.htfTrend;
      const buy = s.side === "buy";
      const good = (trend === "bullish" && buy && o.realizedReturnPct > 0) || (trend === "bearish" && !buy && o.realizedReturnPct < 0);
      const bad = (trend === "bearish" && buy && o.realizedReturnPct < 0) || (trend === "bullish" && !buy && o.realizedReturnPct > 0);
      const score = good ? 0.3 : bad ? -0.35 : 0;
      return contributionFromScore(score, "HTF trend");
    },
  },
  {
    name: "Volume confirmation",
    score: (s, o) => {
      const v = s.features.volumeAnomaly;
      const worked = o.realizedReturnPct > 0;
      const score = v > 0.5 ? (worked ? 0.22 : -0.18) : v < 0.2 && worked ? -0.1 : 0;
      return contributionFromScore(score, "Volume confirmation");
    },
  },
  {
    name: "Resistance proximity",
    score: (s) => {
      const dist = num0(s.features.distFrom7dHighPct);
      const score = dist < 1.5 ? -0.25 : dist > 15 ? 0.1 : 0;
      return contributionFromScore(score, "Resistance proximity");
    },
  },
  {
    name: "Liquidity",
    score: (s, o) => {
      const liq = s.features.liquidity;
      const execOk = o.slippageBps < 40 && (o.feesUsd + o.gasUsd) < Math.max(1, Math.abs(o.realizedPnlUsd)) * 0.25;
      const score = liq > 0.55 && execOk ? 0.2 : liq < 0.3 ? -0.15 : 0;
      return contributionFromScore(score, "Liquidity");
    },
  },
  {
    name: "Social sentiment",
    score: (s, o) => {
      const soc = s.features.social;
      const worked = o.realizedReturnPct > 0;
      const score = soc > 0.5 ? (worked ? 0.12 : -0.12) : 0;
      return contributionFromScore(score, "Social sentiment");
    },
  },
  {
    name: "News/events",
    score: (s, o) => {
      const news = s.features.news;
      const events = s.evidence.eventsNear;
      const worked = o.realizedReturnPct > 0;
      const score = (news > 0.45 || events > 0) ? (worked ? 0.15 : -0.1) : 0;
      return contributionFromScore(score, "News/events");
    },
  },
  {
    name: "Wallet signal",
    score: (s, o) => {
      const hits = s.evidence.walletHits;
      const worked = o.realizedReturnPct > 0;
      const score = hits >= 2 ? (worked ? 0.18 : -0.16) : 0;
      return contributionFromScore(score, "Wallet signal");
    },
  },
  {
    name: "Regime",
    score: (s, o) => {
      const regime = (s.regime.label as string | undefined) ?? "mixed";
      const buy = s.side === "buy";
      const riskOff = /risk.off|panic|fear/i.test(regime);
      const riskOn = /risk.on|greedy|bull/i.test(regime);
      const good = (riskOn && buy && o.realizedReturnPct > 0) || (riskOff && !buy && o.realizedReturnPct < 0);
      const bad = (riskOff && buy && o.realizedReturnPct < 0);
      const score = good ? 0.2 : bad ? -0.25 : 0;
      return contributionFromScore(score, "Regime");
    },
  },
  {
    name: "Risk discipline",
    score: (s, o) => {
      const size = s.riskState.positionPctOfEquity;
      const dd = num0(o.drawdownImpactPct);
      const score = size > 0.12 || dd > 0.05 ? -0.2 : size <= 0.08 && dd < 0.02 ? 0.15 : 0;
      return contributionFromScore(score, "Risk discipline");
    },
  },
  {
    name: "Execution",
    score: (_s, o) => {
      const slippage = o.slippageBps;
      const score = slippage < 15 ? 0.1 : slippage > 60 ? -0.2 : 0;
      return contributionFromScore(score, "Execution");
    },
  },
];

export function computeFeatureAttributions(snapshot: DecisionSnapshot, outcome: TradeOutcome, rewardId: string): FeatureAttribution[] {
  return RULES.map((rule) => {
    const res = rule.score(snapshot, outcome);
    return {
      id: rid(),
      rewardId,
      featureName: rule.name,
      contribution: res.contribution,
      conditionalExpectancy: res.weight,
      evidence: res.evidence,
    };
  });
}

export function extractLesson(
  snapshot: DecisionSnapshot,
  reward: TradeReward,
  attributions: FeatureAttribution[],
): { title: string; body: string; confidence: "HIGH" | "MODERATE" | "LOW" | "INSUFFICIENT_EVIDENCE"; evidence: Record<string, unknown> } {
  const negative = attributions.filter((a) => a.contribution === "NEGATIVE" || a.contribution === "STRONGLY_NEGATIVE");
  const positive = attributions.filter((a) => a.contribution === "POSITIVE" || a.contribution === "STRONGLY_POSITIVE");
  const goodDecision = reward.decisionOutcomeClass === "GOOD_GOOD" || reward.decisionOutcomeClass === "GOOD_BAD";

  if (reward.totalReward >= 0.35 && goodDecision) {
    const features = positive.map((a) => a.featureName).join(", ");
    return {
      title: `Strong decision/outcome alignment: ${features}`,
      body: `This trade combined favourable conditions at decision time and produced a positive reward. Conditions: ${features}.`,
      confidence: positive.length >= 3 ? "HIGH" : "MODERATE",
      evidence: { positive: positive.map((a) => ({ name: a.featureName, weight: a.conditionalExpectancy })), reward: reward.totalReward },
    };
  }

  if (reward.totalReward <= -0.35 && negative.length >= 2) {
    const features = negative.map((a) => a.featureName).join(", ");
    const avoidable = reward.avoidableLoss === "AVOIDABLE" ? "appears avoidable" : "may include unavoidable variance";
    return {
      title: `Poor outcome associated with: ${features}`,
      body: `This trade produced a negative reward. The strongest associated negative features were ${features}. Outcome ${avoidable} based on pre-trade evidence.`,
      confidence: negative.length >= 3 && reward.avoidableLoss === "AVOIDABLE" ? "HIGH" : "MODERATE",
      evidence: { negative: negative.map((a) => ({ name: a.featureName, weight: a.conditionalExpectancy })), reward: reward.totalReward, avoidableLoss: reward.avoidableLoss },
    };
  }

  if (reward.decisionOutcomeClass === "GOOD_BAD") {
    return {
      title: "Good decision, bad outcome",
      body: "Pre-trade evidence supported the decision, but the outcome was negative. This is treated as variance, not a lesson to reverse the decision rule.",
      confidence: "MODERATE",
      evidence: { decisionOutcomeClass: reward.decisionOutcomeClass, reward: reward.totalReward },
    };
  }

  if (reward.decisionOutcomeClass === "BAD_GOOD") {
    return {
      title: "Bad decision, good outcome",
      body: "The outcome was positive despite weak pre-trade evidence. This is treated as luck, not a reason to trust the same setup.",
      confidence: "MODERATE",
      evidence: { decisionOutcomeClass: reward.decisionOutcomeClass, reward: reward.totalReward },
    };
  }

  return {
    title: "No strong lesson",
    body: "The trade produced mixed or neutral evidence. No strong lesson is extracted.",
    confidence: "INSUFFICIENT_EVIDENCE",
    evidence: { reward: reward.totalReward, attributions: attributions.map((a) => ({ name: a.featureName, contribution: a.contribution })) },
  };
}
