import { getSql, type Sql } from "@/lib/db";
import { nowIso } from "../time.ts";
import { num0 } from "../math.ts";
import { createDecisionSnapshot, rid } from "./snapshots.ts";
import { computeFeatureAttributions, extractLesson } from "./attribution.ts";
import { computeReward, REWARD_VERSION } from "./reward.ts";
import { discoverPatterns, MIN_PATTERN_SAMPLES, promotePattern, rejectPattern } from "./patterns.ts";
import { createLearnerVersion, DEFAULT_LEARNER_VERSION, DEFAULT_STRATEGY_ID, DEFAULT_STRATEGY_VERSION, recommendAction } from "./learner.ts";
import { createStrategyCandidate } from "./promotion.ts";
import type { DecisionContext, DecisionSnapshot, DiscoveredPattern, FeatureAttribution, LearnerRecommendation, LearnerVersion, LearningDashboard, LearningOverview, Lesson, StrategyCandidate, TradeOutcome, TradeReward } from "./types.ts";

const DEFAULT_PORTFOLIO_ID = "paper-default";

export function serialize<T>(value: T): string {
  return JSON.stringify(value ?? null);
}

export async function recordDecisionSnapshot(sql: Sql, ctx: DecisionContext): Promise<DecisionSnapshot> {
  const snapshot = createDecisionSnapshot(ctx, DEFAULT_LEARNER_VERSION);
  await sql.query(
    `insert into trade_decision_snapshots (
       id, portfolio_id, asset_id, symbol, decision, side, action_at, strategy_id, strategy_version,
       learner_version, signal_id, order_id, features, market_structure, regime, evidence, risk_state,
       sizing, execution_assumptions, data_quality, expected_value, confidence, learner_recommendation, notes
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19::jsonb,$20::jsonb,$21,$22,$23::jsonb,$24)`,
    [
      snapshot.id, snapshot.portfolioId, snapshot.assetId, snapshot.symbol, snapshot.decision, snapshot.side,
      snapshot.actionAt, snapshot.strategyId, snapshot.strategyVersion, snapshot.learnerVersion,
      snapshot.signalId, snapshot.orderId, serialize(snapshot.features), serialize(snapshot.marketStructure),
      serialize(snapshot.regime), serialize(snapshot.evidence), serialize(snapshot.riskState), serialize(snapshot.sizing),
      serialize(snapshot.executionAssumptions), serialize(snapshot.dataQuality), snapshot.expectedValue,
      snapshot.confidence, serialize(snapshot.learnerRecommendation), snapshot.notes,
    ],
  );
  return snapshot;
}

export async function recordOutcomeFromFills(sql: Sql, opts: {
  entrySnapshotId: string;
  assetId: string;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  realizedPnlUsd: number;
  feesUsd: number;
  gasUsd: number;
  slippageBps: number;
  holdingSeconds: number;
  exitReason: string;
  stopHit: boolean;
  targetHit: boolean;
  mfePct?: number | null;
  maePct?: number | null;
  drawdownImpactPct?: number | null;
  postExitReturnPct?: number | null;
}): Promise<TradeOutcome> {
  const id = rid();
  const entryPx = opts.entryPrice;
  const exitPx = opts.exitPrice;
  const retPct = entryPx > 0 ? ((exitPx - entryPx) / entryPx) * 100 : 0;
  const rMultiple = opts.maePct && opts.maePct !== 0 ? retPct / 100 / Math.abs(opts.maePct) : null;

  const outcome: TradeOutcome = {
    id,
    decisionSnapshotId: opts.entrySnapshotId,
    portfolioId: DEFAULT_PORTFOLIO_ID,
    assetId: opts.assetId,
    exitActionAt: nowIso(),
    entryPrice: entryPx,
    exitPrice: exitPx,
    qty: opts.qty,
    realizedPnlUsd: opts.realizedPnlUsd,
    realizedReturnPct: retPct,
    realizedRMultiple: rMultiple,
    feesUsd: opts.feesUsd,
    gasUsd: opts.gasUsd,
    slippageBps: opts.slippageBps,
    holdingSeconds: opts.holdingSeconds,
    mfePct: opts.mfePct ?? null,
    maePct: opts.maePct ?? null,
    drawdownImpactPct: opts.drawdownImpactPct ?? null,
    exitReason: opts.exitReason,
    stopHit: opts.stopHit,
    targetHit: opts.targetHit,
    thesisInvalidated: opts.stopHit && retPct < 0,
    postExitReturnPct: opts.postExitReturnPct ?? null,
    opportunityCostPct: null,
    createdAt: nowIso(),
  };

  await sql.query(
    `insert into trade_outcomes (
       id, decision_snapshot_id, portfolio_id, asset_id, exit_action_at, entry_price, exit_price, qty,
       realized_pnl_usd, realized_return_pct, realized_r_multiple, fees_usd, gas_usd, slippage_bps,
       holding_seconds, mfe_pct, mae_pct, drawdown_impact_pct, exit_reason, stop_hit, target_hit,
       thesis_invalidated, post_exit_return_pct, opportunity_cost_pct
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
    [
      outcome.id, outcome.decisionSnapshotId, outcome.portfolioId, outcome.assetId, outcome.exitActionAt,
      outcome.entryPrice, outcome.exitPrice, outcome.qty, outcome.realizedPnlUsd, outcome.realizedReturnPct,
      outcome.realizedRMultiple, outcome.feesUsd, outcome.gasUsd, outcome.slippageBps, outcome.holdingSeconds,
      outcome.mfePct, outcome.maePct, outcome.drawdownImpactPct, outcome.exitReason, outcome.stopHit,
      outcome.targetHit, outcome.thesisInvalidated, outcome.postExitReturnPct, outcome.opportunityCostPct,
    ],
  );
  return outcome;
}

export async function computeAndStoreReward(sql: Sql, snapshot: DecisionSnapshot, outcome: TradeOutcome): Promise<TradeReward> {
  const reward = computeReward(snapshot, outcome);
  await sql.query(
    `insert into trade_rewards (
       id, outcome_id, decision_snapshot_id, total_reward, outcome_quality, decision_quality, execution_quality,
       risk_discipline, drawdown_penalty, slippage_penalty, fee_penalty, contradiction_penalty, avoidable_loss,
       decision_outcome_class, version
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      reward.id, reward.outcomeId, reward.decisionSnapshotId, reward.totalReward, reward.components.outcomeQuality,
      reward.components.decisionQuality, reward.components.executionQuality, reward.components.riskDiscipline,
      reward.components.drawdownPenalty, reward.components.slippagePenalty, reward.components.feePenalty,
      reward.components.contradictionPenalty, reward.avoidableLoss, reward.decisionOutcomeClass, reward.version,
    ],
  );

  const attributions = computeFeatureAttributions(snapshot, outcome, reward.id);
  for (const a of attributions) {
    await sql.query(
      `insert into feature_attributions (id, reward_id, feature_name, contribution, conditional_expectancy, evidence)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (reward_id, feature_name) do nothing`,
      [a.id, a.rewardId, a.featureName, a.contribution, a.conditionalExpectancy, a.evidence],
    );
  }

  const lesson = extractLesson(snapshot, reward, attributions);
  await sql.query(
    `insert into lesson_registry (id, pattern_id, trade_reward_id, lesson_type, title, body, evidence, confidence)
     values ($1, null, $2, $3, $4, $5, $6::jsonb, $7)`,
    [rid(), reward.id, reward.totalReward >= 0 ? "POSITIVE" : "NEGATIVE", lesson.title, lesson.body, serialize(lesson.evidence), lesson.confidence],
  );

  return reward;
}

export async function loadCompletedExperiences(sql: Sql, limit = 500): Promise<Array<{ snapshot: DecisionSnapshot; reward: TradeReward }>> {
  const rows = await sql.query<{
    s_id: string;
    s_portfolio_id: string;
    s_asset_id: string;
    s_symbol: string;
    s_decision: string;
    s_side: string | null;
    s_action_at: string;
    s_strategy_id: string;
    s_strategy_version: string;
    s_learner_version: string;
    s_signal_id: string | null;
    s_order_id: string | null;
    s_features: string;
    s_market_structure: string;
    s_regime: string;
    s_evidence: string;
    s_risk_state: string;
    s_sizing: string | null;
    s_execution_assumptions: string | null;
    s_data_quality: string;
    s_expected_value: number | null;
    s_confidence: number | null;
    s_learner_recommendation: string | null;
    s_notes: string | null;
    r_id: string;
    r_outcome_id: string;
    r_total_reward: number;
    r_outcome_quality: number;
    r_decision_quality: number;
    r_execution_quality: number;
    r_risk_discipline: number;
    r_drawdown_penalty: number;
    r_slippage_penalty: number;
    r_fee_penalty: number;
    r_contradiction_penalty: number;
    r_avoidable_loss: string | null;
    r_decision_outcome_class: string | null;
    r_version: string;
  }>(
    `select
      s.id as s_id, s.portfolio_id as s_portfolio_id, s.asset_id as s_asset_id, s.symbol as s_symbol,
      s.decision as s_decision, s.side as s_side, s.action_at as s_action_at, s.strategy_id as s_strategy_id,
      s.strategy_version as s_strategy_version, s.learner_version as s_learner_version, s.signal_id as s_signal_id,
      s.order_id as s_order_id, s.features as s_features, s.market_structure as s_market_structure,
      s.regime as s_regime, s.evidence as s_evidence, s.risk_state as s_risk_state, s.sizing as s_sizing,
      s.execution_assumptions as s_execution_assumptions, s.data_quality as s_data_quality,
      s.expected_value as s_expected_value, s.confidence as s_confidence,
      s.learner_recommendation as s_learner_recommendation, s.notes as s_notes,
      r.id as r_id, r.outcome_id as r_outcome_id, r.total_reward as r_total_reward,
      r.outcome_quality as r_outcome_quality, r.decision_quality as r_decision_quality,
      r.execution_quality as r_execution_quality, r.risk_discipline as r_risk_discipline,
      r.drawdown_penalty as r_drawdown_penalty, r.slippage_penalty as r_slippage_penalty,
      r.fee_penalty as r_fee_penalty, r.contradiction_penalty as r_contradiction_penalty,
      r.avoidable_loss as r_avoidable_loss, r.decision_outcome_class as r_decision_outcome_class,
      r.version as r_version
     from trade_decision_snapshots s
     join trade_outcomes o on o.decision_snapshot_id = s.id
     join trade_rewards r on r.decision_snapshot_id = s.id
     order by s.action_at desc
     limit $1`,
    [limit],
  );

  return rows.map((r) => ({
    snapshot: {
      id: r.s_id,
      portfolioId: r.s_portfolio_id,
      assetId: r.s_asset_id,
      symbol: r.s_symbol,
      decision: r.s_decision as DecisionSnapshot["decision"],
      side: r.s_side as DecisionSnapshot["side"],
      actionAt: r.s_action_at,
      strategyId: r.s_strategy_id,
      strategyVersion: r.s_strategy_version,
      learnerVersion: r.s_learner_version,
      signalId: r.s_signal_id,
      orderId: r.s_order_id,
      features: JSON.parse(r.s_features) as DecisionSnapshot["features"],
      marketStructure: JSON.parse(r.s_market_structure) as DecisionSnapshot["marketStructure"],
      regime: JSON.parse(r.s_regime) as Record<string, unknown>,
      evidence: JSON.parse(r.s_evidence) as DecisionSnapshot["evidence"],
      riskState: JSON.parse(r.s_risk_state) as DecisionSnapshot["riskState"],
      sizing: r.s_sizing ? (JSON.parse(r.s_sizing) as DecisionSnapshot["sizing"]) : null,
      executionAssumptions: r.s_execution_assumptions ? (JSON.parse(r.s_execution_assumptions) as DecisionSnapshot["executionAssumptions"]) : null,
      dataQuality: JSON.parse(r.s_data_quality) as DecisionSnapshot["dataQuality"],
      expectedValue: r.s_expected_value,
      confidence: r.s_confidence,
      learnerRecommendation: r.s_learner_recommendation ? (JSON.parse(r.s_learner_recommendation) as DecisionSnapshot["learnerRecommendation"]) : null,
      notes: r.s_notes,
      createdAt: r.s_action_at,
    },
    reward: {
      id: r.r_id,
      outcomeId: r.r_outcome_id,
      decisionSnapshotId: r.s_id,
      totalReward: r.r_total_reward,
      components: {
        outcomeQuality: r.r_outcome_quality,
        decisionQuality: r.r_decision_quality,
        executionQuality: r.r_execution_quality,
        riskDiscipline: r.r_risk_discipline,
        drawdownPenalty: r.r_drawdown_penalty,
        slippagePenalty: r.r_slippage_penalty,
        feePenalty: r.r_fee_penalty,
        contradictionPenalty: r.r_contradiction_penalty,
      },
      avoidableLoss: r.r_avoidable_loss as TradeReward["avoidableLoss"],
      decisionOutcomeClass: r.r_decision_outcome_class as TradeReward["decisionOutcomeClass"],
      version: r.r_version,
      createdAt: r.s_action_at,
    },
  }));
}

export async function discoverAndStorePatterns(sql: Sql): Promise<DiscoveredPattern[]> {
  const experiences = await loadCompletedExperiences(sql, 2000);
  if (experiences.length < MIN_PATTERN_SAMPLES) return [];

  const snapshots = experiences.map((e) => e.snapshot);
  const rewards = experiences.map((e) => e.reward);

  const enterPatterns = discoverPatterns({ snapshots, rewards, action: "ENTER", groupByRegime: true, groupByAssetScope: true, learnerVersion: DEFAULT_LEARNER_VERSION });
  const waitPatterns = discoverPatterns({ snapshots, rewards, action: "WAIT", groupByRegime: true, groupByAssetScope: false, learnerVersion: DEFAULT_LEARNER_VERSION });
  const rejectPatterns = discoverPatterns({ snapshots, rewards, action: "REJECT", groupByRegime: true, groupByAssetScope: false, learnerVersion: DEFAULT_LEARNER_VERSION });
  const all = [...enterPatterns, ...waitPatterns, ...rejectPatterns];

  for (const p of all) {
    await sql.query(
      `insert into discovered_patterns (
         id, pattern_hash, status, description, conditions, action, regime, asset_scope, sample_count,
         positive_count, negative_count, win_rate, expectancy, avg_reward, reward_variance, confidence_lower,
         confidence_upper, oos_expectancy, walk_forward_stability, recency_weight, first_seen_at, last_seen_at,
         promoted_at, rolled_back_at, champion_version, learner_version
       ) values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
       on conflict (pattern_hash, action, regime, asset_scope, learner_version) do update set
         status = case when discovered_patterns.status = 'APPROVED' then discovered_patterns.status else excluded.status end,
         sample_count = excluded.sample_count, positive_count = excluded.positive_count, negative_count = excluded.negative_count,
         win_rate = excluded.win_rate, expectancy = excluded.expectancy, avg_reward = excluded.avg_reward,
         reward_variance = excluded.reward_variance, confidence_lower = excluded.confidence_lower,
         confidence_upper = excluded.confidence_upper, recency_weight = excluded.recency_weight,
         last_seen_at = excluded.last_seen_at, updated_at = now()`,
      [
        p.id, p.patternHash, p.status, p.description, serialize(p.conditions), p.action, p.regime, p.assetScope,
        p.sampleCount, p.positiveCount, p.negativeCount, p.winRate, p.expectancy, p.avgReward, p.rewardVariance,
        p.confidenceLower, p.confidenceUpper, p.oosExpectancy, p.walkForwardStability, p.recencyWeight,
        p.firstSeenAt, p.lastSeenAt, p.promotedAt, p.rolledBackAt, p.championVersion, p.learnerVersion,
      ],
    );
  }
  return all;
}

export async function getLearnerRecommendation(sql: Sql, ctx: DecisionContext): Promise<{
  recommendation: LearnerRecommendation;
  learnerVersion: string;
}> {
  const snapshot = createDecisionSnapshot(ctx, DEFAULT_LEARNER_VERSION);
  const patternRows = await sql.query<{ id: string; conditions: string; action: string; expectancy: number | null; oos_expectancy: number | null; sample_count: number; last_seen_at: string; status: string }>(
    `select id, conditions, action, expectancy, oos_expectancy, sample_count, last_seen_at, status
     from discovered_patterns
     where status in ('APPROVED', 'DISCOVERED', 'SHADOW')
     order by expectancy desc nulls last
     limit 200`,
  );
  const patterns: DiscoveredPattern[] = patternRows.map((r) => ({
    id: r.id,
    patternHash: "",
    status: r.status as DiscoveredPattern["status"],
    description: "",
    conditions: JSON.parse(r.conditions) as Record<string, string | number | boolean>,
    action: r.action as DiscoveredPattern["action"],
    regime: null,
    assetScope: null,
    sampleCount: r.sample_count,
    positiveCount: 0,
    negativeCount: 0,
    winRate: null,
    expectancy: r.expectancy,
    avgReward: r.expectancy,
    rewardVariance: null,
    confidenceLower: null,
    confidenceUpper: null,
    oosExpectancy: r.oos_expectancy,
    walkForwardStability: null,
    recencyWeight: null,
    firstSeenAt: r.last_seen_at,
    lastSeenAt: r.last_seen_at,
    promotedAt: null,
    rolledBackAt: null,
    championVersion: null,
    learnerVersion: DEFAULT_LEARNER_VERSION,
    createdAt: r.last_seen_at,
    updatedAt: r.last_seen_at,
  }));

  const recommendation = recommendAction({ snapshot, patterns });
  return { recommendation, learnerVersion: DEFAULT_LEARNER_VERSION };
}

export async function ensureLearnerVersion(sql: Sql): Promise<void> {
  const existing = await sql.query<{ count: number }>(
    `select count(*) as count from learner_versions where learner_version = $1 and strategy_id = $2`,
    [DEFAULT_LEARNER_VERSION, DEFAULT_STRATEGY_ID],
  );
  if (num0(existing[0]?.count) > 0) return;

  const learner = createLearnerVersion({
    version: DEFAULT_LEARNER_VERSION,
    strategyId: DEFAULT_STRATEGY_ID,
    strategyVersion: DEFAULT_STRATEGY_VERSION,
    status: "SHADOW",
  });
  await sql.query(
    `insert into learner_versions (
       learner_id, learner_version, status, strategy_id, strategy_version, training_period_start,
       training_period_end, training_experience_count, features_used, hyperparameters, validation_metrics,
       oos_metrics, walk_forward_metrics, ablation_results, sensitivity_results, champion_version
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16)`,
    [
      learner.learnerId, learner.learnerVersion, learner.status, learner.strategyId, learner.strategyVersion,
      learner.trainingPeriodStart, learner.trainingPeriodEnd, learner.trainingExperienceCount,
      serialize(learner.featuresUsed), serialize(learner.hyperparameters), serialize(learner.validationMetrics),
      serialize(learner.oosMetrics), serialize(learner.walkForwardMetrics), serialize(learner.ablationResults),
      serialize(learner.sensitivityResults), learner.championVersion,
    ],
  );

  const candidate = createStrategyCandidate({
    strategyId: DEFAULT_STRATEGY_ID,
    strategyVersion: DEFAULT_STRATEGY_VERSION,
    learnerVersion: DEFAULT_LEARNER_VERSION,
  });
  await sql.query(
    `insert into strategy_candidates (
       id, strategy_id, strategy_version, learner_version, champion_version, status, promotion_pipeline, validation_results
     ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)
     on conflict (strategy_id, strategy_version, learner_version) do nothing`,
    [candidate.id, candidate.strategyId, candidate.strategyVersion, candidate.learnerVersion, candidate.championVersion, candidate.status, serialize(candidate.promotionPipeline), serialize(candidate.validationResults)],
  );
}

export async function runLearningJobs(sql: Sql): Promise<void> {
  await ensureLearnerVersion(sql);
  await discoverAndStorePatterns(sql);

  const experiences = await loadCompletedExperiences(sql, 5000);
  const count = experiences.length;
  await sql.query(
    `update learner_versions set training_experience_count = $1, updated_at = now()
     where learner_version = $2 and strategy_id = $3`,
    [count, DEFAULT_LEARNER_VERSION, DEFAULT_STRATEGY_ID],
  );
}

export async function getLearningDashboard(): Promise<LearningDashboard> {
  const sql = await getSql();
  await ensureLearnerVersion(sql);
  await runLearningJobs(sql);

  const overviewRows = await sql.query<{
    experiences: number;
    positive: number;
    negative: number;
    avg: number | null;
    patterns: number;
    approved: number;
    shadow: number;
    lessons: number;
  }>(
    `select
      (select count(*) from learning_experiences) as experiences,
      (select count(*) from trade_rewards where total_reward > 0) as positive,
      (select count(*) from trade_rewards where total_reward < 0) as negative,
      (select avg(total_reward) from trade_rewards) as avg,
      (select count(*) from discovered_patterns) as patterns,
      (select count(*) from discovered_patterns where status = 'APPROVED') as approved,
      (select count(*) from discovered_patterns where status = 'SHADOW') as shadow,
      (select count(*) from lesson_registry) as lessons`,
  );
  const ov = overviewRows[0]!;
  const learnerRows = await sql.query<{
    learner_version: string;
    status: string;
    champion_version: string | null;
    training_experience_count: number;
  }>(
    `select learner_version, status, champion_version, training_experience_count
     from learner_versions order by created_at desc limit 1`,
  );
  const learner = learnerRows[0];
  const overview: LearningOverview = {
    learnerVersion: learner?.learner_version ?? DEFAULT_LEARNER_VERSION,
    championVersion: learner?.champion_version ?? null,
    challengerVersion: null,
    experiences: num0(ov.experiences),
    positiveRewards: num0(ov.positive),
    negativeRewards: num0(ov.negative),
    averageReward: ov.avg ?? null,
    status: learner?.status ?? "SHADOW",
    patterns: num0(ov.patterns),
    approvedPatterns: num0(ov.approved),
    shadowPatterns: num0(ov.shadow),
    lessons: num0(ov.lessons),
  };

  const tradeRows = await loadCompletedExperiences(sql, 100);
  const goodTrades = tradeRows.filter((t) => t.reward.totalReward > 0.25);
  const badTrades = tradeRows.filter((t) => t.reward.totalReward < -0.25);

  for (const t of [...goodTrades, ...badTrades].slice(0, 20)) {
    t.attributions = await loadAttributions(sql, t.reward.id);
  }

  const patternRows = await sql.query<DiscoveredPattern>(
    `select * from discovered_patterns order by expectancy desc nulls last limit 100`,
  );
  const learnerVersionRows = await sql.query<LearnerVersion>(
    `select * from learner_versions order by created_at desc limit 10`,
  );
  const candidateRows = await sql.query<StrategyCandidate>(
    `select * from strategy_candidates order by created_at desc limit 10`,
  );
  const lessonRows = await sql.query<Lesson>(
    `select * from lesson_registry order by created_at desc limit 50`,
  );

  return {
    overview,
    goodTrades,
    badTrades,
    patterns: patternRows,
    learners: learnerVersionRows,
    candidates: candidateRows,
    lessons: lessonRows,
  };
}

async function loadAttributions(sql: Sql, rewardId: string): Promise<FeatureAttribution[]> {
  const rows = await sql.query<{
    id: string;
    reward_id: string;
    feature_name: string;
    contribution: string;
    conditional_expectancy: number | null;
    evidence: string;
  }>(
    `select id, reward_id, feature_name, contribution, conditional_expectancy, evidence
     from feature_attributions where reward_id = $1`,
    [rewardId],
  );
  return rows.map((r) => ({
    id: r.id,
    rewardId: r.reward_id,
    featureName: r.feature_name,
    contribution: r.contribution as FeatureAttribution["contribution"],
    conditionalExpectancy: r.conditional_expectancy,
    evidence: r.evidence,
  }));
}

export { createDecisionSnapshot, rid, computeReward, computeFeatureAttributions, recommendAction, promotePattern, rejectPattern, extractLesson };
export type { DecisionContext, DecisionSnapshot, TradeReward, TradeOutcome, DiscoveredPattern, LearningDashboard };
