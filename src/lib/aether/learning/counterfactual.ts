/**
 * WAIT is a real decision. REJECT gets a hypothetical fill.
 * Alternative entry timings measure remaining edge after latency.
 */

export type PricePath = {
  /** Unix ms */
  t: number;
  /** Mid */
  px: number;
};

export type HypotheticalOutcome = {
  kind: "WAIT" | "REJECT" | "ALT_ENTRY";
  entryOffsetMs: number | null;
  label: string;
  entered: boolean;
  entryPx: number | null;
  exitPx: number | null;
  pnlPct: number | null;
  maePct: number | null;
  mfePct: number | null;
  feesPct: number;
  opportunityCostPct: number | null;
  avoidedLossPct: number | null;
  avoidedProfitPct: number | null;
  notes: string;
};

const DEFAULT_HOLD_MS = 4 * 3600_000;
const FEE_PCT = 0.003;

function sliceFrom(path: PricePath[], t0: number): PricePath[] {
  return path.filter((p) => p.t >= t0).sort((a, b) => a.t - b.t);
}

function excursion(window: PricePath[], entry: number): { mae: number; mfe: number; last: number } {
  let mae = 0;
  let mfe = 0;
  let last = entry;
  for (const p of window) {
    const ret = ((p.px - entry) / entry) * 100;
    if (ret < mae) mae = ret;
    if (ret > mfe) mfe = ret;
    last = p.px;
  }
  return { mae, mfe, last };
}

export function waitOutcome(opts: {
  path: PricePath[];
  decisionT: number;
  holdMs?: number;
  feePct?: number;
}): HypotheticalOutcome {
  const hold = opts.holdMs ?? DEFAULT_HOLD_MS;
  const fee = opts.feePct ?? FEE_PCT;
  const window = sliceFrom(opts.path, opts.decisionT).filter((p) => p.t <= opts.decisionT + hold);
  if (window.length < 2) {
    return {
      kind: "WAIT",
      entryOffsetMs: null,
      label: "wait",
      entered: false,
      entryPx: null,
      exitPx: null,
      pnlPct: null,
      maePct: null,
      mfePct: null,
      feesPct: 0,
      opportunityCostPct: null,
      avoidedLossPct: null,
      avoidedProfitPct: null,
      notes: "INSUFFICIENT EVIDENCE: path too short after WAIT.",
    };
  }
  const entry = window[0]!.px;
  const { mae, mfe, last } = excursion(window, entry);
  const gross = ((last - entry) / entry) * 100;
  const net = gross - fee * 2 * 100;
  const avoidedLoss = net < 0 ? -net : 0;
  const avoidedProfit = net > 0 ? net : 0;
  return {
    kind: "WAIT",
    entryOffsetMs: 0,
    label: "wait",
    entered: false,
    entryPx: entry,
    exitPx: last,
    pnlPct: net,
    maePct: mae,
    mfePct: mfe,
    feesPct: fee * 2 * 100,
    opportunityCostPct: avoidedProfit || null,
    avoidedLossPct: avoidedLoss || null,
    avoidedProfitPct: avoidedProfit || null,
    notes:
      net < 0
        ? `WAIT was correct: hypothetical entry would have lost ${net.toFixed(2)}%.`
        : `WAIT may have been conservative: market moved ${net.toFixed(2)}% in favour of the skipped long.`,
  };
}

export function rejectCounterfactual(opts: {
  path: PricePath[];
  decisionT: number;
  holdMs?: number;
  feePct?: number;
}): HypotheticalOutcome {
  const wait = waitOutcome(opts);
  return {
    ...wait,
    kind: "REJECT",
    label: "reject_hypothetical",
    notes:
      wait.pnlPct == null
        ? wait.notes
        : wait.pnlPct < 0
          ? `REJECT filter likely prevented a ${wait.pnlPct.toFixed(2)}% loss after fees.`
          : `REJECT may have blocked a ${wait.pnlPct.toFixed(2)}% gain — review whether the filter was too tight.`,
  };
}

export const ENTRY_OFFSETS_MS = [
  { label: "immediate", ms: 0 },
  { label: "+1 minute", ms: 60_000 },
  { label: "+5 minutes", ms: 5 * 60_000 },
  { label: "+15 minutes", ms: 15 * 60_000 },
  { label: "+30 minutes", ms: 30 * 60_000 },
  { label: "next candle", ms: null as number | null },
] as const;

export function alternativeEntries(opts: {
  path: PricePath[];
  decisionT: number;
  holdMs?: number;
  feePct?: number;
  barMs?: number;
}): HypotheticalOutcome[] {
  const hold = opts.holdMs ?? DEFAULT_HOLD_MS;
  const fee = opts.feePct ?? FEE_PCT;
  const barMs = opts.barMs ?? 60_000;
  const out: HypotheticalOutcome[] = [];
  for (const off of ENTRY_OFFSETS_MS) {
    const offset = off.ms == null ? barMs : off.ms;
    const tEnter = opts.decisionT + offset;
    const window = sliceFrom(opts.path, tEnter).filter((p) => p.t <= tEnter + hold);
    if (window.length < 2) {
      out.push({
        kind: "ALT_ENTRY",
        entryOffsetMs: offset,
        label: off.label,
        entered: false,
        entryPx: null,
        exitPx: null,
        pnlPct: null,
        maePct: null,
        mfePct: null,
        feesPct: 0,
        opportunityCostPct: null,
        avoidedLossPct: null,
        avoidedProfitPct: null,
        notes: "DATA UNAVAILABLE at this offset.",
      });
      continue;
    }
    const entry = window[0]!.px;
    const { mae, mfe, last } = excursion(window, entry);
    const net = ((last - entry) / entry) * 100 - fee * 2 * 100;
    out.push({
      kind: "ALT_ENTRY",
      entryOffsetMs: offset,
      label: off.label,
      entered: true,
      entryPx: entry,
      exitPx: last,
      pnlPct: net,
      maePct: mae,
      mfePct: mfe,
      feesPct: fee * 2 * 100,
      opportunityCostPct: null,
      avoidedLossPct: null,
      avoidedProfitPct: null,
      notes: `Entry ${off.label} net ${net.toFixed(2)}% after fees (MFE ${mfe.toFixed(2)} / MAE ${mae.toFixed(2)}).`,
    });
  }
  return out;
}

export function remainingEdge(alts: HypotheticalOutcome[]): {
  bestLabel: string | null;
  decayFromImmediatePct: number | null;
  notes: string;
} {
  const immediate = alts.find((a) => a.label === "immediate" && a.pnlPct != null);
  const later = alts.filter((a) => a.label !== "immediate" && a.pnlPct != null);
  if (!immediate || immediate.pnlPct == null || !later.length) {
    return { bestLabel: immediate?.label ?? null, decayFromImmediatePct: null, notes: "INSUFFICIENT EVIDENCE" };
  }
  const best = [...alts].filter((a) => a.pnlPct != null).sort((a, b) => (b.pnlPct ?? 0) - (a.pnlPct ?? 0))[0];
  const last = later[later.length - 1]!;
  const decay = immediate.pnlPct - (last.pnlPct ?? 0);
  return {
    bestLabel: best?.label ?? "immediate",
    decayFromImmediatePct: decay,
    notes: `Immediate edge ${immediate.pnlPct.toFixed(2)}% vs ${last.label} ${last.pnlPct?.toFixed(2)}% (decay ${decay.toFixed(2)}pp).`,
  };
}
