import { clamp, maxDrawdown, mean, sharpe, sortino } from "./math.ts";
import { simulateFill, type FillModelInput, type SimulatedFill } from "./paper.ts";

/**
 * Dual capital profiles.
 *
 * Research £100,000 is a laboratory for experience throughput.
 * It must NEVER be treated as the user's real capital.
 *
 * Realistic £100 is the deployment gate. A strategy that only works at
 * £100k is CAPITAL-DEPENDENT — not deployment ready.
 */
export type CapitalProfileId = "research" | "realistic";
export type CapitalClassification = "CAPITAL-INDEPENDENT" | "CAPITAL-SENSITIVE" | "CAPITAL-DEPENDENT";

export const CAPITAL_SCALES_GBP = [100, 250, 500, 1_000, 5_000, 10_000, 100_000] as const;
export type CapitalScaleGbp = (typeof CAPITAL_SCALES_GBP)[number];

export const RESEARCH_EQUITY_GBP = 100_000;
export const REALISTIC_EQUITY_GBP = 100;

export type CapitalProfile = {
  id: CapitalProfileId;
  label: string;
  equityGbp: number;
  purpose: string;
  minTradePct: number;
  maxTradePct: number;
  maxPositionPct: number;
  minCashPct: number;
  minOrderGbp: number;
  maxLiquidityTakePct: number;
  maxVolumeTakePct: number;
};

export const RESEARCH_PROFILE: CapitalProfile = {
  id: "research",
  label: "Research laboratory",
  equityGbp: RESEARCH_EQUITY_GBP,
  purpose: "Increase legitimate simultaneous opportunities and statistical learning. Not a forecast of deployable capital.",
  minTradePct: 0.01,
  maxTradePct: 0.03,
  maxPositionPct: 0.18,
  minCashPct: 0.22,
  minOrderGbp: 60,
  maxLiquidityTakePct: 0.02,
  maxVolumeTakePct: 0.02,
};

export const REALISTIC_PROFILE: CapitalProfile = {
  id: "realistic",
  label: "Realistic deployment (£100)",
  equityGbp: REALISTIC_EQUITY_GBP,
  purpose: "Test whether a learned behaviour still works with ~£100, fees, min size and liquidity.",
  minTradePct: 0.01,
  maxTradePct: 0.03,
  maxPositionPct: 0.2,
  minCashPct: 0.15,
  minOrderGbp: 8,
  maxLiquidityTakePct: 0.015,
  maxVolumeTakePct: 0.015,
};

export function profileFor(id: CapitalProfileId): CapitalProfile {
  return id === "realistic" ? REALISTIC_PROFILE : RESEARCH_PROFILE;
}

export type FxQuote = {
  gbpUsd: number;
  observedAt: string;
  source: string;
};

export function gbpToUsd(gbp: number, fx: FxQuote | null): { usd: number | null; reason: string | null } {
  if (!fx || !(fx.gbpUsd > 0)) return { usd: null, reason: "DATA UNAVAILABLE: GBPUSD" };
  return { usd: gbp * fx.gbpUsd, reason: null };
}

export function usdToGbp(usd: number, fx: FxQuote | null): { gbp: number | null; reason: string | null } {
  if (!fx || !(fx.gbpUsd > 0)) return { gbp: null, reason: "DATA UNAVAILABLE: GBPUSD" };
  return { gbp: usd / fx.gbpUsd, reason: null };
}

export type SizingRequest = {
  profile: CapitalProfile;
  equityGbp: number;
  cashGbp: number;
  confidence: number;
  liquidityUsd: number;
  volume24hUsd: number;
  fx: FxQuote | null;
  volatilityPct?: number;
  historicalReliability?: number;
};

export type SizingDecision = {
  ok: boolean;
  rejectReason: string | null;
  notionalGbp: number;
  notionalUsd: number | null;
  tradePct: number;
  positionPct: number;
  executableAt100: boolean;
  minimumRequiredCapitalGbp: number | null;
};

/**
 * Size a research or realistic order. Never inflate a £100 ticket past 3% just
 * to clear a minimum — that would teach the learner the wrong lesson.
 * If 1–3% of equity is below min order after converting, REJECT.
 */
export function sizeForProfile(req: SizingRequest, opts?: { skipExecutableProbe?: boolean }): SizingDecision {
  const p = req.profile;
  const conf = clamp(req.confidence, 0.3, 0.9);
  const rel = clamp(req.historicalReliability ?? 0.55, 0.2, 1);
  const vol = Math.max(0, req.volatilityPct ?? 5);
  const volHaircut = vol > 12 ? 0.55 : vol > 8 ? 0.75 : vol > 5 ? 0.9 : 1;
  const tradePct = (p.minTradePct + (p.maxTradePct - p.minTradePct) * conf * rel) * volHaircut;
  const rawGbp = req.equityGbp * tradePct;
  const cashCap = req.cashGbp * (1 - p.minCashPct);
  let notionalGbp = Math.min(rawGbp, cashCap, req.equityGbp * p.maxPositionPct);

  const fxUsd = gbpToUsd(notionalGbp, req.fx);
  const liqCapUsd = req.liquidityUsd * p.maxLiquidityTakePct;
  const volCapUsd = req.volume24hUsd * p.maxVolumeTakePct;
  if (fxUsd.usd != null) {
    const capUsd = Math.min(liqCapUsd || Infinity, volCapUsd || Infinity);
    if (Number.isFinite(capUsd) && capUsd > 0 && fxUsd.usd > capUsd) {
      notionalGbp = capUsd / req.fx!.gbpUsd;
    }
  }

  const tradePctActual = req.equityGbp > 0 ? notionalGbp / req.equityGbp : 0;
  const executableAt100 = opts?.skipExecutableProbe
    ? { ok: req.equityGbp <= 100 && notionalGbp >= p.minOrderGbp, minCapitalGbp: REALISTIC_EQUITY_GBP }
    : isExecutableAtGbp(100, {
        confidence: req.confidence,
        liquidityUsd: req.liquidityUsd,
        volume24hUsd: req.volume24hUsd,
        fx: req.fx,
      });

  if (!(notionalGbp > 0)) {
    return {
      ok: false,
      rejectReason: "No remaining cash after cash-floor and liquidity caps",
      notionalGbp: 0,
      notionalUsd: fxUsd.usd,
      tradePct: 0,
      positionPct: 0,
      executableAt100: executableAt100.ok,
      minimumRequiredCapitalGbp: executableAt100.minCapitalGbp,
    };
  }
  if (notionalGbp + 0.5 < p.minOrderGbp) {
    return {
      ok: false,
      rejectReason: `Notional £${notionalGbp.toFixed(2)} below min order £${p.minOrderGbp} — REJECT not practically deployable at this scale`,
      notionalGbp,
      notionalUsd: fxUsd.usd,
      tradePct: tradePctActual,
      positionPct: tradePctActual,
      executableAt100: executableAt100.ok,
      minimumRequiredCapitalGbp: executableAt100.minCapitalGbp,
    };
  }
  if (req.liquidityUsd > 0 && req.fx && fxUsd.usd != null && fxUsd.usd / req.liquidityUsd > p.maxLiquidityTakePct) {
    return {
      ok: false,
      rejectReason: "Order would take more than allowed book depth",
      notionalGbp,
      notionalUsd: fxUsd.usd,
      tradePct: tradePctActual,
      positionPct: tradePctActual,
      executableAt100: executableAt100.ok,
      minimumRequiredCapitalGbp: executableAt100.minCapitalGbp,
    };
  }
  if (req.volume24hUsd > 0 && req.fx && fxUsd.usd != null && fxUsd.usd / req.volume24hUsd > p.maxVolumeTakePct) {
    return {
      ok: false,
      rejectReason: "Order too large versus 24h volume — no giant fills",
      notionalGbp,
      notionalUsd: fxUsd.usd,
      tradePct: tradePctActual,
      positionPct: tradePctActual,
      executableAt100: executableAt100.ok,
      minimumRequiredCapitalGbp: executableAt100.minCapitalGbp,
    };
  }

  return {
    ok: true,
    rejectReason: null,
    notionalGbp,
    notionalUsd: fxUsd.usd,
    tradePct: tradePctActual,
    positionPct: tradePctActual,
    executableAt100: executableAt100.ok,
    minimumRequiredCapitalGbp: executableAt100.minCapitalGbp,
  };
}

export function isExecutableAtGbp(
  equityGbp: number,
  opts: { confidence: number; liquidityUsd: number; volume24hUsd: number; fx: FxQuote | null },
): { ok: boolean; minCapitalGbp: number | null; reason: string | null } {
  const probe = sizeForProfile({
    profile: {
      ...REALISTIC_PROFILE,
      equityGbp,
      minOrderGbp: REALISTIC_PROFILE.minOrderGbp,
    },
    equityGbp,
    cashGbp: equityGbp,
    confidence: opts.confidence,
    liquidityUsd: opts.liquidityUsd,
    volume24hUsd: opts.volume24hUsd,
    fx: opts.fx,
  }, { skipExecutableProbe: true });
  if (probe.ok) return { ok: true, minCapitalGbp: equityGbp, reason: null };
  // Smallest scale on the ladder that would clear min order at 3%.
  const minFromOrder = REALISTIC_PROFILE.minOrderGbp / REALISTIC_PROFILE.maxTradePct;
  const minFromLiq = opts.fx && opts.fx.gbpUsd > 0 && opts.liquidityUsd > 0
    ? (REALISTIC_PROFILE.minOrderGbp) // already gbp
    : minFromOrder;
  const minCapital = Math.max(minFromOrder, minFromLiq);
  return { ok: false, minCapitalGbp: minCapital, reason: probe.rejectReason };
}

export function simulateCapitalAwareFill(opts: {
  profile: CapitalProfile;
  fill: Omit<FillModelInput, "notionalUsd"> & { notionalUsd?: number };
  notionalUsd: number;
  volume24hUsd: number;
}): SimulatedFill {
  const takeLiq = opts.notionalUsd / Math.max(opts.fill.liquidityUsd, 1);
  const takeVol = opts.notionalUsd / Math.max(opts.volume24hUsd, 1);
  if (opts.fill.liquidityUsd < 5_000) {
    return simulateFill({ ...opts.fill, notionalUsd: opts.notionalUsd });
  }
  if (takeLiq > opts.profile.maxLiquidityTakePct) {
    return {
      ok: false,
      rejectReason: "Liquidity take exceeds realistic book-depth cap",
      qty: 0,
      price: 0,
      requestedNotionalUsd: opts.notionalUsd,
      notionalUsd: 0,
      feeUsd: 0,
      gasUsd: 0,
      slippageBps: 0,
      impactBps: 0,
      latencyMs: opts.fill.latencyMs,
      midAtSignal: opts.fill.mid,
      midAtFill: opts.fill.mid,
      model: "capital-aware.v1",
    };
  }
  if (opts.volume24hUsd > 0 && takeVol > opts.profile.maxVolumeTakePct) {
    return {
      ok: false,
      rejectReason: "Notional exceeds 24h volume take cap — no giant fills",
      qty: 0,
      price: 0,
      requestedNotionalUsd: opts.notionalUsd,
      notionalUsd: 0,
      feeUsd: 0,
      gasUsd: 0,
      slippageBps: 0,
      impactBps: 0,
      latencyMs: opts.fill.latencyMs,
      midAtSignal: opts.fill.mid,
      midAtFill: opts.fill.mid,
      model: "capital-aware.v1",
    };
  }
  return simulateFill({ ...opts.fill, notionalUsd: opts.notionalUsd });
}

export type ScaleTrade = {
  returnPct: number;
  pnlGbp: number;
  feesGbp: number;
  slippageBps: number;
  notionalGbp: number;
  rejected: boolean;
};

export type ScaleReport = {
  equityGbp: number;
  returnPct: number;
  pnlGbp: number;
  maxDrawdownPct: number;
  sharpe: number;
  sortino: number;
  calmar: number | null;
  expectancy: number;
  winRate: number | null;
  avgWinPct: number;
  avgLossPct: number;
  feesGbp: number;
  avgSlippageBps: number;
  nTrades: number;
  nRejected: number;
  avgPositionGbp: number;
  maxSimultaneous: number;
  capitalUtilisation: number;
  notes: string;
};

export function summariseScale(equityGbp: number, trades: ScaleTrade[], maxSimultaneous = 0, utilisation = 0): ScaleReport {
  const taken = trades.filter((t) => !t.rejected);
  const rets = taken.map((t) => t.returnPct / 100);
  const wins = taken.filter((t) => t.returnPct > 0);
  const losses = taken.filter((t) => t.returnPct <= 0);
  const pnl = taken.reduce((a, t) => a + t.pnlGbp, 0);
  const fees = trades.reduce((a, t) => a + t.feesGbp, 0);
  const eqPath = [equityGbp];
  let eq = equityGbp;
  for (const t of taken) {
    eq += t.pnlGbp;
    eqPath.push(eq);
  }
  const dd = maxDrawdown(eqPath) * 100;
  const retPct = equityGbp ? (pnl / equityGbp) * 100 : 0;
  const sh = sharpe(rets);
  const so = sortino(rets);
  const calmar = dd > 0 ? retPct / dd : null;
  const expectancy = taken.length ? mean(taken.map((t) => t.returnPct)) : 0;
  return {
    equityGbp,
    returnPct: retPct,
    pnlGbp: pnl,
    maxDrawdownPct: dd,
    sharpe: sh,
    sortino: so,
    calmar,
    expectancy,
    winRate: taken.length ? wins.length / taken.length : null,
    avgWinPct: wins.length ? mean(wins.map((t) => t.returnPct)) : 0,
    avgLossPct: losses.length ? mean(losses.map((t) => t.returnPct)) : 0,
    feesGbp: fees,
    avgSlippageBps: taken.length ? mean(taken.map((t) => t.slippageBps)) : 0,
    nTrades: taken.length,
    nRejected: trades.filter((t) => t.rejected).length,
    avgPositionGbp: taken.length ? mean(taken.map((t) => t.notionalGbp)) : 0,
    maxSimultaneous,
    capitalUtilisation: utilisation,
    notes: taken.length ? "Scale report from provided trades." : "INSUFFICIENT EVIDENCE",
  };
}

export function classifyCapitalSensitivity(reports: ScaleReport[]): {
  classification: CapitalClassification;
  minViableGbp: number | null;
  degradation: Array<{ equityGbp: number; returnPct: number; nTrades: number; nRejected: number }>;
  reason: string;
} {
  const bySize = [...reports].sort((a, b) => a.equityGbp - b.equityGbp);
  const at100 = bySize.find((r) => r.equityGbp === 100);
  const at100k = bySize.find((r) => r.equityGbp === 100_000);
  const degradation = bySize.map((r) => ({
    equityGbp: r.equityGbp,
    returnPct: r.returnPct,
    nTrades: r.nTrades,
    nRejected: r.nRejected,
  }));

  if (!at100 || !at100k) {
    return {
      classification: "CAPITAL-SENSITIVE",
      minViableGbp: null,
      degradation,
      reason: "INSUFFICIENT EVIDENCE: need both £100 and £100,000 scale reports.",
    };
  }
  if (at100.nTrades === 0 && at100k.nTrades > 0) {
    return {
      classification: "CAPITAL-DEPENDENT",
      minViableGbp: bySize.find((r) => r.nTrades > 0)?.equityGbp ?? 100_000,
      degradation,
      reason: "Works at £100k research size but cannot place any realistic £100 tickets. CAPITAL-SCALE DEPENDENT — NOT DEPLOYMENT READY.",
    };
  }
  const viable = bySize.find((r) => r.nTrades >= 5 && (r.expectancy > 0 || r.returnPct > 0));
  if (at100.nTrades >= 5 && Math.abs(at100.expectancy - at100k.expectancy) < 0.4) {
    return {
      classification: "CAPITAL-INDEPENDENT",
      minViableGbp: 100,
      degradation,
      reason: "Behaviour is similar at £100 and £100k (expectancy within 0.4pp).",
    };
  }
  if (at100.nTrades > 0 && at100.expectancy + 0.15 < at100k.expectancy) {
    return {
      classification: "CAPITAL-SENSITIVE",
      minViableGbp: viable?.equityGbp ?? null,
      degradation,
      reason: "Edge degrades as capital shrinks. Not silently promotion-ready.",
    };
  }
  return {
    classification: at100.nTrades > 0 ? "CAPITAL-SENSITIVE" : "CAPITAL-DEPENDENT",
    minViableGbp: viable?.equityGbp ?? null,
    degradation,
    reason: at100.nTrades > 0 ? "Partial executability at £100." : "INSUFFICIENT EVIDENCE at £100.",
  };
}

export function profileFromEnv(): CapitalProfileId {
  const raw = typeof process === "undefined" ? undefined : process.env.PAPER_CAPITAL_PROFILE;
  if (raw && raw.trim().toLowerCase() === "realistic") return "realistic";
  return "research";
}
