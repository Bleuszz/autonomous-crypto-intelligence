import { PAPER_FEES } from "./config.ts";
import { clamp, round, seededUnit } from "./math.ts";

export type FillModelInput = {
  side: "buy" | "sell";
  mid: number;
  notionalUsd: number;
  liquidityUsd: number;
  volatilityPct: number;
  latencyMs: number;
  feeBps?: number;
  gasUsd?: number;
  seed?: string;
};

export type SimulatedFill = {
  ok: boolean;
  rejectReason: string | null;
  qty: number;
  price: number;
  notionalUsd: number;
  feeUsd: number;
  gasUsd: number;
  slippageBps: number;
  latencyMs: number;
  midAtSignal: number;
  midAtFill: number;
  model: string;
};

/**
 * Do not assume we can trade at the observed/signal mid.
 * Apply latency drift, size vs liquidity impact, fees and gas.
 */
export function simulateFill(input: FillModelInput): SimulatedFill {
  const feeBps = input.feeBps ?? PAPER_FEES.dexFeeBps;
  const gasUsd = input.gasUsd ?? 0;
  const mid = input.mid;
  const model = "latency+impact+fee.v1";

  if (!(mid > 0) || !(input.notionalUsd > 0)) {
    return {
      ok: false,
      rejectReason: "Invalid price or size",
      qty: 0,
      price: 0,
      notionalUsd: 0,
      feeUsd: 0,
      gasUsd: 0,
      slippageBps: 0,
      latencyMs: input.latencyMs,
      midAtSignal: mid,
      midAtFill: mid,
      model,
    };
  }
  if (input.liquidityUsd < 5_000) {
    return {
      ok: false,
      rejectReason: "Liquidity below executable threshold",
      qty: 0,
      price: 0,
      notionalUsd: 0,
      feeUsd: 0,
      gasUsd: 0,
      slippageBps: 0,
      latencyMs: input.latencyMs,
      midAtSignal: mid,
      midAtFill: mid,
      model,
    };
  }

  const unit = seededUnit(input.seed ?? `${input.side}:${input.notionalUsd}:${mid}`);
  const vol = Math.max(0.15, input.volatilityPct) / 100;
  const latencySec = input.latencyMs / 1000;
  // Brownian-ish drift over latency; sign is not known in our favour.
  const drift = vol * Math.sqrt(Math.max(latencySec, 0.5) / (60 * 60 * 24)) * (unit * 2 - 1) * 18;
  const midAtFill = mid * (1 + drift);

  const take = input.notionalUsd / Math.max(input.liquidityUsd, 1);
  const impactBps = PAPER_FEES.baseSlippageBps + take * 10_000 * 0.85;
  const dir = input.side === "buy" ? 1 : -1;
  const slipFrac = impactBps / 10_000;
  const price = midAtFill * (1 + dir * slipFrac);

  if (price <= 0) {
    return {
      ok: false,
      rejectReason: "Non-positive modelled fill price",
      qty: 0,
      price: 0,
      notionalUsd: 0,
      feeUsd: 0,
      gasUsd: 0,
      slippageBps: impactBps,
      latencyMs: input.latencyMs,
      midAtSignal: mid,
      midAtFill,
      model,
    };
  }

  const feeUsd = input.notionalUsd * (feeBps / 10_000);
  const spend = input.side === "buy" ? input.notionalUsd - feeUsd - gasUsd : input.notionalUsd;
  if (spend <= 0) {
    return {
      ok: false,
      rejectReason: "Fees consume the entire order",
      qty: 0,
      price,
      notionalUsd: 0,
      feeUsd,
      gasUsd,
      slippageBps: impactBps,
      latencyMs: input.latencyMs,
      midAtSignal: mid,
      midAtFill,
      model,
    };
  }

  const qty = input.side === "buy" ? spend / price : input.notionalUsd / price;
  return {
    ok: true,
    rejectReason: null,
    qty: round(qty, 10),
    price: round(price, 10),
    notionalUsd: round(qty * price, 6),
    feeUsd: round(feeUsd, 6),
    gasUsd: round(gasUsd, 6),
    slippageBps: round(impactBps, 2),
    latencyMs: input.latencyMs,
    midAtSignal: mid,
    midAtFill: round(midAtFill, 10),
    model,
  };
}

export function pickLatencyMs(seed: string, min = PAPER_FEES.latencyMsMin, max = PAPER_FEES.latencyMsMax): number {
  const u = seededUnit(`lat:${seed}`);
  return Math.round(min + u * (max - min));
}

export function gasForChain(chainId: string | null | undefined): number {
  if (!chainId) return PAPER_FEES.gasUsdL2;
  if (chainId === "ethereum" || chainId === "eth") return PAPER_FEES.gasUsdEth;
  if (chainId === "solana") return PAPER_FEES.gasUsdSol;
  return PAPER_FEES.gasUsdL2;
}

export function positionSizeUsd(equity: number, confidence: number, maxPct: number, liquidityUsd: number, maxTakePct: number): number {
  const confScale = clamp(confidence, 0.3, 0.9);
  const raw = equity * maxPct * confScale;
  const capLiq = liquidityUsd * maxTakePct;
  return Math.max(0, Math.min(raw, capLiq, equity * maxPct));
}

export function mirrorFill(opts: {
  observedPrice: number;
  observedNotional: number;
  liquidityUsd: number;
  volatilityPct: number;
  ourNotional: number;
  chainId?: string | null;
  seed: string;
}): SimulatedFill {
  // Copying at the observed print is not realistic.
  const latencyMs = pickLatencyMs(opts.seed) + 800;
  return simulateFill({
    side: "buy",
    mid: opts.observedPrice,
    notionalUsd: opts.ourNotional,
    liquidityUsd: opts.liquidityUsd,
    volatilityPct: opts.volatilityPct,
    latencyMs,
    gasUsd: gasForChain(opts.chainId),
    seed: `mirror:${opts.seed}`,
  });
}
