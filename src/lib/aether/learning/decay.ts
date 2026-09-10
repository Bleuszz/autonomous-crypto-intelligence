/**
 * Information decay: an event detected immediately may still have edge;
 * the same event minutes later may have none.
 */

export type DecayEvent = {
  publishedAt: number;
  detectedAt: number;
  analysisAt: number;
  marketReactionStart: number | null;
  marketReactionPeak: number | null;
  priceAtPublish: number | null;
  priceAtDetect: number | null;
  priceAtPeak: number | null;
  falsePositive: boolean;
};

export type DecayReport = {
  detectionLatencyMs: number;
  analysisLatencyMs: number;
  reactionLatencyMs: number | null;
  movePublishToDetectPct: number | null;
  moveDetectToPeakPct: number | null;
  remainingEdgeFraction: number | null;
  falsePositive: boolean;
  notes: string;
};

export function informationDecay(ev: DecayEvent): DecayReport {
  const detectionLatencyMs = Math.max(0, ev.detectedAt - ev.publishedAt);
  const analysisLatencyMs = Math.max(0, ev.analysisAt - ev.detectedAt);
  const reactionLatencyMs =
    ev.marketReactionStart != null ? Math.max(0, ev.marketReactionStart - ev.publishedAt) : null;

  const movePublishToDetectPct =
    ev.priceAtPublish && ev.priceAtDetect && ev.priceAtPublish > 0
      ? ((ev.priceAtDetect - ev.priceAtPublish) / ev.priceAtPublish) * 100
      : null;
  const moveDetectToPeakPct =
    ev.priceAtDetect && ev.priceAtPeak && ev.priceAtDetect > 0
      ? ((ev.priceAtPeak - ev.priceAtDetect) / ev.priceAtDetect) * 100
      : null;

  let remaining: number | null = null;
  if (movePublishToDetectPct != null && moveDetectToPeakPct != null) {
    const total = Math.abs(movePublishToDetectPct) + Math.abs(moveDetectToPeakPct);
    remaining = total > 0 ? Math.abs(moveDetectToPeakPct) / total : 0;
  } else if (detectionLatencyMs > 15 * 60_000) {
    remaining = 0.1;
  }

  let notes: string;
  if (ev.falsePositive) {
    notes = "False positive: no sustained market reaction after detection.";
  } else if (remaining == null) {
    notes = "INSUFFICIENT EVIDENCE to measure remaining edge.";
  } else if (remaining < 0.15) {
    notes = "Most of the move had already printed before detection. Little remaining edge.";
  } else if (remaining > 0.6) {
    notes = "Detection was early relative to the peak. Remaining edge is material.";
  } else {
    notes = "Partial remaining edge after detection latency.";
  }

  return {
    detectionLatencyMs,
    analysisLatencyMs,
    reactionLatencyMs,
    movePublishToDetectPct,
    moveDetectToPeakPct,
    remainingEdgeFraction: remaining,
    falsePositive: ev.falsePositive,
    notes,
  };
}

export function inferReaction(opts: {
  publishedAt: number;
  path: Array<{ t: number; px: number }>;
  thresholdPct?: number;
}): { start: number | null; peak: number | null; falsePositive: boolean } {
  const thr = opts.thresholdPct ?? 0.4;
  const after = opts.path.filter((p) => p.t >= opts.publishedAt).sort((a, b) => a.t - b.t);
  if (after.length < 3) return { start: null, peak: null, falsePositive: true };
  const px0 = after[0]!.px;
  if (!(px0 > 0)) return { start: null, peak: null, falsePositive: true };
  let start: number | null = null;
  let peakT = after[0]!.t;
  let peakMove = 0;
  for (const p of after) {
    const move = ((p.px - px0) / px0) * 100;
    if (start == null && Math.abs(move) >= thr) start = p.t;
    if (Math.abs(move) > Math.abs(peakMove)) {
      peakMove = move;
      peakT = p.t;
    }
  }
  return {
    start,
    peak: start == null ? null : peakT,
    falsePositive: start == null,
  };
}
