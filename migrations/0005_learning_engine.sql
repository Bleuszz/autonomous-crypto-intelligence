-- Reward + Adaptive Learning Engine schema.
-- Unowned rows (auth is off). No secrets, no personal data, paper-only.

-- Existing tables referenced by the ingest pipeline need an updated_at column.
alter table copy_signals add column if not exists updated_at timestamptz;

-- Immutable snapshot of every paper decision (entry, exit, wait, reject) with full context.
create table if not exists trade_decision_snapshots (
  id text primary key,
  portfolio_id text not null default 'paper-default',
  asset_id text not null,
  symbol text not null,
  decision text not null, -- 'ENTER', 'WAIT', 'REJECT'
  side text, -- 'buy' or 'sell' for executed decisions
  action_at timestamptz not null default now(),
  strategy_id text not null,
  strategy_version text not null,
  learner_version text not null default 'none',
  signal_id text,
  order_id text,
  features jsonb not null default '{}', -- deterministic feature vector at decision time
  market_structure jsonb not null default '{}',
  regime jsonb not null default '{}',
  evidence jsonb not null default '{}', -- signal agreement, events, social, wallets
  risk_state jsonb not null default '{}',
  sizing jsonb not null default '{}',
  execution_assumptions jsonb not null default '{}',
  data_quality jsonb not null default '{}', -- freshness, source reliability
  expected_value double precision,
  confidence double precision,
  learner_recommendation jsonb, -- shadow prediction stored at decision time
  notes text,
  created_at timestamptz not null default now(),
  unique (portfolio_id, asset_id, action_at, decision, strategy_id)
);
create index if not exists trade_decision_snapshots_asset_idx on trade_decision_snapshots (asset_id, action_at desc);
create index if not exists trade_decision_snapshots_strategy_idx on trade_decision_snapshots (strategy_id, strategy_version);
create index if not exists trade_decision_snapshots_learner_idx on trade_decision_snapshots (learner_version);

-- Outcome snapshot recorded when a round-trip closes. Never mutates the entry snapshot.
create table if not exists trade_outcomes (
  id text primary key,
  decision_snapshot_id text not null references trade_decision_snapshots(id) on delete cascade,
  portfolio_id text not null default 'paper-default',
  asset_id text not null,
  exit_action_at timestamptz not null default now(),
  entry_price double precision not null,
  exit_price double precision not null,
  qty double precision not null,
  realized_pnl_usd double precision not null,
  realized_return_pct double precision not null,
  realized_r_multiple double precision,
  fees_usd double precision not null default 0,
  gas_usd double precision not null default 0,
  slippage_bps double precision not null default 0,
  holding_seconds double precision not null default 0,
  mfe_pct double precision, -- max favourable excursion
  mae_pct double precision, -- max adverse excursion
  drawdown_impact_pct double precision,
  exit_reason text not null,
  stop_hit boolean not null default false,
  target_hit boolean not null default false,
  thesis_invalidated boolean not null default false,
  post_exit_return_pct double precision, -- price movement after exit for counterfactual research
  opportunity_cost_pct double precision,
  created_at timestamptz not null default now()
);
create index if not exists trade_outcomes_asset_idx on trade_outcomes (asset_id, exit_action_at desc);
create index if not exists trade_outcomes_decision_idx on trade_outcomes (decision_snapshot_id);

-- Per-trade reward decomposition.
create table if not exists trade_rewards (
  id text primary key,
  outcome_id text not null references trade_outcomes(id) on delete cascade,
  decision_snapshot_id text not null references trade_decision_snapshots(id) on delete cascade,
  total_reward double precision not null,
  outcome_quality double precision not null,
  decision_quality double precision not null,
  execution_quality double precision not null,
  risk_discipline double precision not null,
  drawdown_penalty double precision not null default 0,
  slippage_penalty double precision not null default 0,
  fee_penalty double precision not null default 0,
  contradiction_penalty double precision not null default 0,
  avoidable_loss text check (avoidable_loss in ('AVOIDABLE', 'PROBABLY_UNAVOIDABLE', 'INSUFFICIENT_EVIDENCE', null)),
  decision_outcome_class text check (decision_outcome_class in ('GOOD_GOOD', 'GOOD_BAD', 'BAD_GOOD', 'BAD_BAD', null)),
  version text not null default '1.0.0',
  created_at timestamptz not null default now()
);
create index if not exists trade_rewards_decision_idx on trade_rewards (decision_snapshot_id);

-- Feature attribution for each completed trade.
create table if not exists feature_attributions (
  id text primary key,
  reward_id text not null references trade_rewards(id) on delete cascade,
  feature_name text not null,
  contribution text not null check (contribution in ('STRONGLY_POSITIVE', 'POSITIVE', 'NEUTRAL', 'NEGATIVE', 'STRONGLY_NEGATIVE')),
  conditional_expectancy double precision,
  evidence text,
  created_at timestamptz not null default now(),
  unique (reward_id, feature_name)
);

-- Discovered conditional patterns with statistical gating.
create table if not exists discovered_patterns (
  id text primary key,
  pattern_hash text not null,
  status text not null default 'DISCOVERED' check (status in ('DISCOVERED', 'SHADOW', 'VALIDATING', 'APPROVED', 'REJECTED')),
  description text not null,
  conditions jsonb not null default '{}',
  action text not null check (action in ('ENTER', 'WAIT', 'REJECT')),
  regime text,
  asset_scope text,
  sample_count integer not null default 0,
  positive_count integer not null default 0,
  negative_count integer not null default 0,
  win_rate double precision,
  expectancy double precision,
  avg_reward double precision,
  reward_variance double precision,
  confidence_lower double precision,
  confidence_upper double precision,
  oos_expectancy double precision,
  walk_forward_stability double precision,
  recency_weight double precision,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  promoted_at timestamptz,
  rolled_back_at timestamptz,
  champion_version text,
  learner_version text not null default 'none',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pattern_hash, action, regime, asset_scope, learner_version)
);
create index if not exists discovered_patterns_status_idx on discovered_patterns (status, expectancy desc);
create index if not exists discovered_patterns_hash_idx on discovered_patterns (pattern_hash);

-- Human-readable lessons extracted from patterns and notable trades.
create table if not exists lesson_registry (
  id text primary key,
  pattern_id text references discovered_patterns(id) on delete set null,
  trade_reward_id text references trade_rewards(id) on delete set null,
  lesson_type text not null check (lesson_type in ('POSITIVE', 'NEGATIVE', 'CAVEAT')),
  title text not null,
  body text not null,
  evidence jsonb not null default '{}',
  confidence text not null check (confidence in ('HIGH', 'MODERATE', 'LOW', 'INSUFFICIENT_EVIDENCE')),
  created_at timestamptz not null default now()
);
create index if not exists lesson_registry_type_idx on lesson_registry (lesson_type, created_at desc);

-- Learning experiences used to train/promote learners.
create table if not exists learning_experiences (
  id text primary key,
  learner_version text not null,
  decision_snapshot_id text not null references trade_decision_snapshots(id) on delete cascade,
  reward_id text references trade_rewards(id) on delete set null,
  pattern_signatures jsonb not null default '[]',
  feature_vector jsonb not null default '{}',
  reward double precision,
  outcome jsonb not null default '{}',
  attribution jsonb not null default '{}',
  validation_status text not null default 'IN_SAMPLE' check (validation_status in ('IN_SAMPLE', 'OOS', 'WALK_FORWARD', 'REJECTED')),
  used_for_training boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists learning_experiences_learner_idx on learning_experiences (learner_version, validation_status);

-- Learner/model versions with full provenance.
create table if not exists learner_versions (
  learner_id text primary key,
  learner_version text not null,
  status text not null default 'SHADOW' check (status in ('SHADOW', 'CANDIDATE', 'VALIDATING', 'APPROVED', 'REJECTED', 'ROLLED_BACK')),
  strategy_id text not null,
  strategy_version text not null,
  training_period_start timestamptz,
  training_period_end timestamptz,
  training_experience_count integer not null default 0,
  features_used jsonb not null default '[]',
  hyperparameters jsonb not null default '{}',
  validation_metrics jsonb not null default '{}',
  oos_metrics jsonb not null default '{}',
  walk_forward_metrics jsonb not null default '{}',
  ablation_results jsonb not null default '{}',
  sensitivity_results jsonb not null default '{}',
  champion_version text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  rolled_back_at timestamptz,
  rollback_reason text,
  unique (learner_version, strategy_id)
);
create index if not exists learner_versions_status_idx on learner_versions (status, created_at desc);

-- Strategy candidates / champion registry.
create table if not exists strategy_candidates (
  id text primary key,
  strategy_id text not null,
  strategy_version text not null,
  learner_version text not null,
  champion_version text,
  status text not null default 'CANDIDATE' check (status in ('CANDIDATE', 'SHADOW', 'VALIDATING', 'APPROVED', 'REJECTED', 'ROLLED_BACK')),
  promotion_pipeline jsonb not null default '{}',
  validation_results jsonb not null default '{}',
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  rolled_back_at timestamptz,
  rollback_reason text,
  unique (strategy_id, strategy_version, learner_version)
);
create index if not exists strategy_candidates_status_idx on strategy_candidates (status, created_at desc);

-- Counterfactual research records (post-trade only; never mutates snapshots).
create table if not exists counterfactuals (
  id text primary key,
  outcome_id text not null references trade_outcomes(id) on delete cascade,
  scenario text not null, -- 'ENTER_LATER', 'WAIT', 'REJECT', 'SMALLER_SIZE', 'OPTIMAL_EXIT'
  simulated_pnl_usd double precision,
  simulated_return_pct double precision,
  assumptions jsonb not null default '{}',
  created_at timestamptz not null default now()
);
