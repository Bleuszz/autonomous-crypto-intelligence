import type { Sql } from "@/lib/db";
import { rid } from "./snapshots.ts";
import {
  assignSplit,
  correlationGroup,
  qualityWeight,
  type TrainingExperience,
} from "./experiences.ts";
import type { HypotheticalOutcome } from "./counterfactual.ts";
import type { DecayReport } from "./decay.ts";
import type { ScaleReport } from "../capital.ts";
import type { ReplayResult } from "../replay.ts";

export async function persistTrainingExperience(sql: Sql, exp: TrainingExperience, snapshotId?: string | null): Promise<void> {
  await sql.query(
    `insert into training_experiences (
       id, capital_profile, starting_equity_gbp, available_equity_gbp, position_size_gbp,
       portfolio_exposure_pct, capital_utilisation_pct, regime, asset, asset_class, market_structure,
       signal_type, data_quality, source_conflict, event_cluster_id, decision_timestamp,
       latest_market_data_timestamp, latest_news_timestamp, latest_social_timestamp, latest_event_timestamp,
       analysis_timestamp, decision, confidence, executable_at_100, minimum_required_capital_gbp,
       capital_sensitivity, outcome, reward, learning_weight, split, used_for_training,
       correlation_group, lookahead_clean, negative_example, historical_replay, asset_state,
       decision_snapshot_id
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37)
     on conflict (id) do nothing`,
    [
      exp.id, exp.capitalProfile, exp.startingEquityGbp, exp.availableEquityGbp, exp.positionSizeGbp,
      exp.portfolioExposurePct, exp.capitalUtilisationPct, exp.regime, exp.asset, exp.assetClass, exp.marketStructure,
      exp.signalType, exp.dataQuality, exp.sourceConflict, exp.eventClusterId, exp.decisionTimestamp,
      exp.latestMarketDataTimestamp, exp.latestNewsTimestamp, exp.latestSocialTimestamp, exp.latestEventTimestamp,
      exp.analysisTimestamp, exp.decision, exp.confidence, exp.executableAt100, exp.minimumRequiredCapitalGbp,
      exp.capitalSensitivity, exp.outcome, exp.reward, exp.learningWeight, exp.split, exp.usedForTraining,
      exp.correlationGroup, exp.lookaheadClean, exp.negativeExample, exp.historicalReplay, exp.assetState,
      snapshotId ?? null,
    ],
  );
}

export async function persistCounterfactual(sql: Sql, experienceId: string, h: HypotheticalOutcome): Promise<void> {
  await sql.query(
    `insert into counterfactual_outcomes (
       id, experience_id, kind, label, entry_offset_ms, pnl_pct, mae_pct, mfe_pct,
       opportunity_cost_pct, avoided_loss_pct, notes
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      rid(), experienceId, h.kind, h.label, h.entryOffsetMs, h.pnlPct, h.maePct, h.mfePct,
      h.opportunityCostPct, h.avoidedLossPct, h.notes,
    ],
  );
}

export async function persistDecay(sql: Sql, opts: { eventId?: string | null; clusterId?: string | null; report: DecayReport }): Promise<void> {
  await sql.query(
    `insert into information_decay (
       id, event_id, cluster_id, detection_latency_ms, analysis_latency_ms, reaction_latency_ms,
       remaining_edge_fraction, false_positive, notes
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      rid(), opts.eventId ?? null, opts.clusterId ?? null,
      opts.report.detectionLatencyMs, opts.report.analysisLatencyMs, opts.report.reactionLatencyMs,
      opts.report.remainingEdgeFraction, opts.report.falsePositive, opts.report.notes,
    ],
  );
}

export async function persistScaleRun(sql: Sql, report: ScaleReport, classification: string, learnerVersion?: string | null): Promise<void> {
  await sql.query(
    `insert into capital_scale_runs (id, strategy_id, learner_version, equity_gbp, metrics, classification, notes)
     values ($1,'ensemble',$2,$3,$4::jsonb,$5,$6)`,
    [rid(), learnerVersion ?? null, report.equityGbp, JSON.stringify(report), classification, report.notes],
  );
}

export async function persistReplayRun(sql: Sql, result: ReplayResult, delayMs: number, capitalProfile: string): Promise<void> {
  await sql.query(
    `insert into replay_runs (id, delay_ms, capital_profile, fills, rejected, waits, lookahead_failures, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [rid(), delayMs, capitalProfile, result.fills, result.rejected, result.waits, result.lookaheadFailures, result.notes],
  );
}

export function learningWeightFor(score: number, sourceConflict: boolean, fakeMove: boolean, lookaheadClean: boolean): number {
  if (!lookaheadClean) return 0;
  return qualityWeight(score, sourceConflict, fakeMove);
}

export function splitForTimestamp(tMs: number, start: number, end: number) {
  return assignSplit(tMs, { start, end });
}

export function correlationFor(symbol: string, regime: string): string {
  return correlationGroup(symbol, regime);
}
