import type { ConflictState, EvidenceItem, FlowState, IndicatorReading, MarketStructureState, MultiTimeframeState, SupportResistanceLevel, TradingIntelContext } from "./types.ts";
export function collectEvidence(opts: { indicators: IndicatorReading[]; structure: MarketStructureState | null; levels: SupportResistanceLevel[]; mtf: MultiTimeframeState; flow: FlowState; ctx: TradingIntelContext }): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const rsi = opts.indicators.find(i => i.name === "RSI");
  if (rsi?.value != null) {
    if (rsi.value >= 60) items.push({ side: "bullish", source: "RSI", weight: 0.18, detail: `RSI ${rsi.value.toFixed(1)}` });
    else if (rsi.value <= 40) items.push({ side: "bearish", source: "RSI", weight: 0.18, detail: `RSI ${rsi.value.toFixed(1)}` });
    else items.push({ side: "neutral", source: "RSI", weight: 0.06, detail: `RSI ${rsi.value.toFixed(1)} mid-range` });
  }
  const macd = opts.indicators.find(i => i.name === "MACD");
  if (macd?.extras.hist != null) items.push({ side: macd.extras.hist > 0 ? "bullish" : macd.extras.hist < 0 ? "bearish" : "neutral", source: "MACD", weight: 0.16, detail: `hist ${macd.extras.hist.toFixed(4)}` });
  const ema = opts.indicators.find(i => i.name === "EMA");
  if (ema?.value != null && ema.extras.last != null) items.push({ side: ema.extras.last > ema.value ? "bullish" : ema.extras.last < ema.value ? "bearish" : "neutral", source: "EMA", weight: 0.16, detail: "price vs EMA-21" });
  if (opts.structure && opts.structure.freshness === "AVAILABLE") items.push({ side: opts.structure.bias === "neutral" ? "neutral" : opts.structure.bias, source: "structure", weight: 0.28, detail: `${opts.structure.regime} ${opts.structure.bias}` });
  if (opts.mtf.trendAlignment === "aligned_bull") items.push({ side: "bullish", source: "mtf", weight: 0.3, detail: opts.mtf.note });
  else if (opts.mtf.trendAlignment === "aligned_bear") items.push({ side: "bearish", source: "mtf", weight: 0.3, detail: opts.mtf.note });
  else if (opts.mtf.trendAlignment === "conflict") items.push({ side: "conflict", source: "mtf", weight: 0.32, detail: opts.mtf.note });
  const overhead = opts.levels.find(l => l.kind === "resistance" && l.distancePct >= 0 && l.distancePct <= 1.2);
  if (overhead) items.push({ side: "bearish", source: "resistance", weight: 0.2, detail: `Resistance ${overhead.distancePct.toFixed(2)}% overhead` });
  const under = opts.levels.find(l => l.kind === "support" && l.distancePct <= 0 && l.distancePct >= -1.2);
  if (under) items.push({ side: "bullish", source: "support", weight: 0.16, detail: `Support ${Math.abs(under.distancePct).toFixed(2)}% below` });
  if (opts.flow.volumeAvailability === "AVAILABLE" && opts.flow.volumeChangePct != null && opts.flow.volumeChangePct < -25) items.push({ side: "bearish", source: "volume", weight: 0.18, detail: `Volume change ${opts.flow.volumeChangePct.toFixed(1)}%` });
  if (opts.flow.fundingAvailability === "AVAILABLE" && opts.flow.fundingPct != null) {
    if (opts.flow.fundingPct >= 0.04) items.push({ side: "bearish", source: "funding", weight: 0.22, detail: `Funding extreme ${opts.flow.fundingPct.toFixed(3)}%` });
    else if (opts.flow.fundingPct <= -0.03) items.push({ side: "bullish", source: "funding", weight: 0.16, detail: `Crowded shorts ${opts.flow.fundingPct.toFixed(3)}%` });
  }
  if (opts.ctx.eventRisk === "bearish") items.push({ side: "bearish", source: "event", weight: 0.26, detail: "Event risk elevated" });
  if (opts.ctx.eventRisk === "bullish") items.push({ side: "bullish", source: "event", weight: 0.12, detail: "Event tape constructive" });
  if (opts.ctx.socialBias === "bearish") items.push({ side: "bearish", source: "social", weight: 0.08, detail: "Social bias bearish" });
  if (opts.ctx.socialBias === "bullish") items.push({ side: "bullish", source: "social", weight: 0.08, detail: "Social bias bullish" });
  if (opts.ctx.polymarketBias === "bearish") items.push({ side: "bearish", source: "polymarket", weight: 0.1, detail: "Polymarket bias bearish" });
  if (opts.ctx.polymarketBias === "bullish") items.push({ side: "bullish", source: "polymarket", weight: 0.1, detail: "Polymarket bias bullish" });
  return items;
}
export function scoreConflict(items: EvidenceItem[]): ConflictState {
  const bullish = items.filter(i => i.side === "bullish");
  const bearish = items.filter(i => i.side === "bearish");
  const neutral = items.filter(i => i.side === "neutral");
  const conflicting = items.filter(i => i.side === "conflict");
  const b = bullish.reduce((a,i)=>a+i.weight,0);
  const s = bearish.reduce((a,i)=>a+i.weight,0);
  const c = conflicting.reduce((a,i)=>a+i.weight,0);
  const total = b + s + c + 0.0001;
  const conflictScore = Math.min(1, (Math.min(b,s)*2 + c) / total);
  const net = b - s;
  const confidence = Math.max(0, Math.min(1, Math.abs(net) / (total + 0.4) * (1 - conflictScore * 0.7)));
  let reason = "No strong technical conflict";
  if (conflictScore >= 0.45) reason = `Conflict score ${conflictScore.toFixed(2)} — bullish ${b.toFixed(2)} vs bearish ${s.toFixed(2)}`;
  else if (b > s) reason = "Bullish evidence outweighs bearish";
  else if (s > b) reason = "Bearish evidence outweighs bullish";
  return { bullish, bearish, neutral, conflicting, conflictScore, confidence, reason };
}
