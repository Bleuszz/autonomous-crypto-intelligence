import { assertNoLookahead, candlesAsOf, candlesFromSparkline } from "./candles.ts";
import { collectEvidence, scoreConflict } from "./conflict.ts";
import { analyzeFlow } from "./flow.ts";
import { computeIndicators } from "./indicators.ts";
import { detectLevels } from "./levels.ts";
import { analyzeMultiTimeframe } from "./mtf.ts";
import { detectStructure } from "./structure.ts";
import { TRADING_INTEL_VERSION, type IntelDecision, type Timeframe, type TradingIntelContext, type TradingIntelligence } from "./types.ts";

export type GatedIntent = { assetId: string; symbol: string; side: "buy" | "sell"; strategyId: string; reason: string; confidence: number; fraction: number; explanation: string[] };

export function emptyContext(partial: Partial<TradingIntelContext> & Pick<TradingIntelContext, "assetId" | "symbol" | "decisionTimestamp">): TradingIntelContext {
  return { candlesByTf: {}, volume24hUsd: null, liquidityUsd: null, spreadBps: null, orderBookImbalance: null, orderBookDepthUsd: null, openInterest: null, fundingPct: null, liquidationsUsd: null, cvd: null, eventRisk: "UNAVAILABLE", socialBias: "UNAVAILABLE", polymarketBias: "UNAVAILABLE", hardRiskBlocks: [], capitalProfile: null, ...partial };
}

function primaryTf(ctx: TradingIntelContext) {
  const order: Timeframe[] = ["1D", "4h", "1h", "15m", "5m"];
  for (const tf of order) {
    const candles = candlesAsOf(ctx.candlesByTf[tf], ctx.decisionTimestamp);
    if (candles.length >= 8) return { tf, candles };
  }
  return { tf: "1D" as Timeframe, candles: [] };
}

export function evaluateTradingIntelligence(ctx: TradingIntelContext): TradingIntelligence {
  const { tf, candles } = primaryTf(ctx);
  const lookaheadClean = assertNoLookahead(candles, ctx.decisionTimestamp);
  const indicators = computeIndicators({ timeframe: tf, candles, decisionTimestamp: ctx.decisionTimestamp });
  const structure = candles.length >= 12 ? detectStructure({ timeframe: tf, candles, decisionTimestamp: ctx.decisionTimestamp }) : null;
  const levels = detectLevels({ timeframe: tf, candles, decisionTimestamp: ctx.decisionTimestamp });
  const mtf = analyzeMultiTimeframe({ candlesByTf: ctx.candlesByTf, decisionTimestamp: ctx.decisionTimestamp });
  const flow = analyzeFlow(ctx, candles);
  const technicalEvidence = collectEvidence({ indicators, structure, levels, mtf, flow, ctx });
  const conflict = scoreConflict(technicalEvidence);
  const reasons: string[] = [];
  let decision: IntelDecision = "WAIT";
  if (ctx.hardRiskBlocks.length) { decision = "REJECT"; reasons.push(...ctx.hardRiskBlocks.map(b => `Hard risk: ${b}`)); }
  else if (!lookaheadClean) { decision = "REJECT"; reasons.push("Look-ahead firewall failed"); }
  else if (!candles.length) { decision = "WAIT"; reasons.push("NO DATA"); }
  else if (conflict.conflictScore >= 0.45) { decision = "WAIT"; reasons.push(conflict.reason); }
  else if (structure?.bias === "bearish" && ctx.proposedSide === "buy") { decision = "WAIT"; reasons.push("Proposed long against bearish market structure"); }
  else if (mtf.trendAlignment === "aligned_bear" && ctx.proposedSide === "buy") { decision = "WAIT"; reasons.push("Higher-timeframe alignment is bearish"); }
  else if (conflict.bullish.reduce((a,i)=>a+i.weight,0) > conflict.bearish.reduce((a,i)=>a+i.weight,0) + 0.2) { decision = "ENTER"; reasons.push("Technical evidence supports the tape without a hard conflict"); }
  else { decision = "WAIT"; reasons.push("INSUFFICIENT EVIDENCE to force an entry"); }
  if (decision === "ENTER" && ctx.proposedSide == null) { decision = "WAIT"; reasons.push("Technical layer does not invent an entry the desk did not propose"); }
  const confidence = decision === "REJECT" ? Math.min(conflict.confidence, 0.35) : conflict.confidence;
  return {
    version: TRADING_INTEL_VERSION, symbol: ctx.symbol, assetId: ctx.assetId, timestamp: ctx.decisionTimestamp,
    decision, confidence, indicators, structure, levels, mtf, flow, conflict, reasons, technicalEvidence,
    marketStructureSummary: structure ? `${structure.regime} / ${structure.bias} (${structure.events.map(e=>e.kind).slice(0,6).join(", ") || "no events"})` : "NO DATA",
    volumeState: flow.volumeAvailability === "UNAVAILABLE" ? "UNAVAILABLE" : `volume ${flow.volume ?? "n/a"} Δ ${flow.volumeChangePct?.toFixed(1) ?? "n/a"}%`,
    liquidityState: ctx.liquidityUsd == null ? "UNAVAILABLE" : `liquidityUsd ${Math.round(ctx.liquidityUsd).toLocaleString()}`,
    eventState: ctx.eventRisk === "UNAVAILABLE" ? "UNAVAILABLE" : ctx.eventRisk,
    socialState: ctx.socialBias === "UNAVAILABLE" ? "UNAVAILABLE" : ctx.socialBias,
    polymarketState: ctx.polymarketBias === "UNAVAILABLE" ? "UNAVAILABLE" : ctx.polymarketBias,
    riskState: ctx.hardRiskBlocks.length ? ctx.hardRiskBlocks.join("; ") : "no hard-risk block",
    lookaheadClean, strategyVersion: TRADING_INTEL_VERSION,
  };
}

export function gateIntentWithTechnicalEvidence(intent: GatedIntent, intel: TradingIntelligence): { intent: GatedIntent; veto: boolean; reason: string | null } {
  if (intent.side === "sell") return { intent, veto: false, reason: null };
  if (intel.decision === "REJECT") return { intent: { ...intent, confidence: Math.min(intent.confidence, 0.2), explanation: [...intent.explanation, ...intel.reasons] }, veto: true, reason: intel.reasons[0] ?? "Technical REJECT" };
  if (intel.decision === "WAIT") return { intent: { ...intent, confidence: Math.min(intent.confidence, 0.45), explanation: [...intent.explanation, `Technical WAIT: ${intel.reasons[0] ?? intel.conflict.reason}`] }, veto: true, reason: intel.reasons[0] ?? intel.conflict.reason };
  return { intent: { ...intent, explanation: [...intent.explanation, `Technical ENTER conf ${(intel.confidence*100).toFixed(0)}%`] }, veto: false, reason: null };
}

export function contextFromSparkline(opts: { assetId: string; symbol: string; sparkline7d: number[] | null | undefined; lastCloseMs: number; decisionTimestamp: string; volume24hUsd?: number | null; liquidityUsd?: number | null; fundingPct?: number | null }): TradingIntelContext {
  const daily = candlesFromSparkline(opts.sparkline7d, opts.lastCloseMs);
  return emptyContext({ assetId: opts.assetId, symbol: opts.symbol, decisionTimestamp: opts.decisionTimestamp, candlesByTf: { "1D": daily }, volume24hUsd: opts.volume24hUsd ?? null, liquidityUsd: opts.liquidityUsd ?? null, fundingPct: opts.fundingPct ?? null });
}
