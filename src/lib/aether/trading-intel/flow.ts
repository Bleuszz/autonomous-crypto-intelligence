import { candlesAsOf } from "./candles.ts";
import type { Availability, FlowState, Ohlcv, TradingIntelContext } from "./types.ts";
function avail(v: number | null | undefined): { value: number | null; availability: Availability } {
  if (v == null || !Number.isFinite(v)) return { value: null, availability: "UNAVAILABLE" };
  return { value: v, availability: "AVAILABLE" };
}
export function analyzeFlow(ctx: TradingIntelContext, primary: Ohlcv[] | undefined): FlowState {
  const candles = candlesAsOf(primary, ctx.decisionTimestamp);
  let volumeChangePct: number | null = null;
  let volumeAvailability: Availability = ctx.volume24hUsd == null ? "UNAVAILABLE" : "AVAILABLE";
  if (candles.length >= 8 && candles.every(c => c.v != null)) {
    const recent = candles.slice(-4).reduce((a,c)=>a+(c.v??0),0);
    const prior = candles.slice(-8,-4).reduce((a,c)=>a+(c.v??0),0);
    if (prior > 0) { volumeChangePct = ((recent-prior)/prior)*100; volumeAvailability = "AVAILABLE"; }
  }
  const vol = avail(ctx.volume24hUsd), spread = avail(ctx.spreadBps), imb = avail(ctx.orderBookImbalance);
  const depth = avail(ctx.orderBookDepthUsd), oi = avail(ctx.openInterest), fund = avail(ctx.fundingPct);
  const liq = avail(ctx.liquidationsUsd), cvd = avail(ctx.cvd);
  const bookAvailability: Availability = imb.availability === "AVAILABLE" || depth.availability === "AVAILABLE" ? "AVAILABLE" : "UNAVAILABLE";
  let aggressiveBias: FlowState["aggressiveBias"] = "UNAVAILABLE";
  if (cvd.availability === "AVAILABLE" && cvd.value != null) aggressiveBias = cvd.value > 0 ? "bullish" : cvd.value < 0 ? "bearish" : "neutral";
  else if (imb.availability === "AVAILABLE" && imb.value != null) aggressiveBias = imb.value > 0.15 ? "bullish" : imb.value < -0.15 ? "bearish" : "neutral";
  return { volume: vol.value, volumeChangePct, volumeAvailability, spreadBps: spread.value, spreadAvailability: spread.availability, orderBookImbalance: imb.value, orderBookDepthUsd: depth.value, bookAvailability, openInterest: oi.value, oiAvailability: oi.availability, fundingPct: fund.value, fundingAvailability: fund.availability, liquidationsUsd: liq.value, liquidationsAvailability: liq.availability, cvd: cvd.value, cvdAvailability: cvd.availability, aggressiveBias };
}
