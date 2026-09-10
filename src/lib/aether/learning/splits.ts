import { walkForwardSplit, rollingWalkForward } from "../backtest.ts";
import type { DatasetSplit } from "./experiences.ts";

/**
 * Strict separation: RAW → TRAINING → VALIDATION → OOS → WALK-FORWARD → PAPER CANARY.
 * Never train on OOS and then claim the same rows demonstrate validation.
 */

export type SplitRow = { t: number; id: string };

export type Contamination = {
  ok: boolean;
  overlaps: Array<{ id: string; splits: DatasetSplit[] }>;
  reason: string;
};

export function chronologicalBuckets<T extends SplitRow>(
  rows: T[],
): { training: T[]; validation: T[]; oos: T[]; walkForward: T[] } {
  const sorted = [...rows].sort((a, b) => a.t - b.t);
  const { inSample, outOfSample } = walkForwardSplit(sorted, 0.7);
  const trainCut = Math.max(1, Math.floor(inSample.length * 0.8));
  const training = inSample.slice(0, trainCut);
  const validation = inSample.slice(trainCut);
  const oosCut = Math.max(1, Math.floor(outOfSample.length * 0.5));
  const oos = outOfSample.slice(0, oosCut);
  const walkForward = outOfSample.slice(oosCut);
  return { training, validation, oos, walkForward };
}

export function detectContamination(map: Map<string, DatasetSplit[]>): Contamination {
  const overlaps: Array<{ id: string; splits: DatasetSplit[] }> = [];
  for (const [id, splits] of map.entries()) {
    const unique = [...new Set(splits)];
    const trainish = unique.includes("TRAINING");
    const held = unique.some((s) => s === "OOS" || s === "WALK_FORWARD" || s === "VALIDATION" || s === "PAPER_CANARY");
    if (trainish && held) overlaps.push({ id, splits: unique });
  }
  if (overlaps.length) {
    return {
      ok: false,
      overlaps,
      reason: `${overlaps.length} experiences appear in both training and a held-out split.`,
    };
  }
  return { ok: true, overlaps: [], reason: "No train/held-out contamination detected." };
}

export function rollingFolds<T extends SplitRow>(rows: T[], trainSize: number, testSize: number) {
  return rollingWalkForward([...rows].sort((a, b) => a.t - b.t), { trainSize, testSize });
}

export function assertMonotonic(rows: SplitRow[]): { ok: boolean; reason: string } {
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.t < rows[i - 1]!.t) {
      return { ok: false, reason: `Non-monotonic timestamp at index ${i}` };
    }
  }
  return { ok: true, reason: "Timestamps are non-decreasing." };
}
