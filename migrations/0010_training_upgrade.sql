-- Training / data-quality / realistic-capital layer.
-- Unowned rows (auth off). No secrets. Paper-only.

create table if not exists asset_data_quality (
  id text primary key,
  asset_id text not null,
  symbol text not null,
  score double precision not null,
  components jsonb not null default '{}',
  flags jsonb not null default '[]',
  source_conflict boolean not null default false,
  conflicting_sources jsonb not null default '[]',
  conflict_type text,
  conflict_severity text,
  conflict_details text,
  delayed boolean not null default false,
  stale boolean not null default false,
  fake_move_suspected boolean not null default false,
  wash_trade_suspected boolean not null default false,
  event_confirmed boolean,
  news_confirmed boolean,
  block_entry boolean not null default false,
  block_reason text,
  learning_weight double precision not null default 1,
  quote_count integer not null default 0,
  spread_bps double precision,
  observed_at timestamptz not null default now()
);
create index if not exists asset_data_quality_asset_idx on asset_data_quality (asset_id, observed_at desc);

create table if not exists source_quotes (
  id text primary key,
  asset_id text not null,
  symbol text not null,
  source text not null,
  price_usd double precision not null,
  volume_24h_usd double precision,
  observed_at timestamptz not null,
  ingested_at timestamptz not null default now()
);
create index if not exists source_quotes_asset_idx on source_quotes (asset_id, observed_at desc);

create table if not exists source_conflicts (
  id text primary key,
  asset_id text not null,
  conflict_type text not null,
  conflict_severity text not null,
  conflicting_sources jsonb not null default '[]',
  details text,
  observed_at timestamptz not null default now()
);

create table if not exists event_clusters (
  cluster_id text primary key,
  title text not null,
  member_ids jsonb not null default '[]',
  sources jsonb not null default '[]',
  independent_source_count integer not null default 1,
  first_published_at timestamptz,
  last_observed_at timestamptz not null default now()
);

create table if not exists asset_lifecycle (
  asset_id text primary key,
  symbol text,
  state text not null default 'ACTIVE' check (state in ('ACTIVE','ILLIQUID','DELISTED','FAILED','RUGGED','UNKNOWN')),
  reason text,
  last_observed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists training_experiences (
  id text primary key,
  capital_profile text not null default 'research',
  starting_equity_gbp double precision,
  available_equity_gbp double precision,
  position_size_gbp double precision,
  portfolio_exposure_pct double precision,
  capital_utilisation_pct double precision,
  regime text,
  asset text,
  asset_class text,
  market_structure text,
  signal_type text,
  data_quality double precision,
  source_conflict boolean not null default false,
  event_cluster_id text,
  decision_timestamp timestamptz not null default now(),
  latest_market_data_timestamp timestamptz,
  latest_news_timestamp timestamptz,
  latest_social_timestamp timestamptz,
  latest_event_timestamp timestamptz,
  analysis_timestamp timestamptz,
  decision text not null,
  confidence double precision,
  executable_at_100 boolean,
  minimum_required_capital_gbp double precision,
  capital_sensitivity text,
  outcome text,
  reward double precision,
  learning_weight double precision not null default 1,
  split text not null default 'TRAINING',
  used_for_training boolean not null default false,
  correlation_group text,
  lookahead_clean boolean not null default true,
  negative_example boolean not null default false,
  historical_replay boolean not null default false,
  asset_state text not null default 'ACTIVE',
  decision_snapshot_id text,
  created_at timestamptz not null default now()
);
create index if not exists training_experiences_split_idx on training_experiences (split, decision_timestamp desc);
create index if not exists training_experiences_asset_idx on training_experiences (asset, decision_timestamp desc);

create table if not exists counterfactual_outcomes (
  id text primary key,
  experience_id text,
  kind text not null check (kind in ('WAIT','REJECT','ALT_ENTRY')),
  label text,
  entry_offset_ms double precision,
  pnl_pct double precision,
  mae_pct double precision,
  mfe_pct double precision,
  opportunity_cost_pct double precision,
  avoided_loss_pct double precision,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists information_decay (
  id text primary key,
  event_id text,
  cluster_id text,
  detection_latency_ms double precision,
  analysis_latency_ms double precision,
  reaction_latency_ms double precision,
  remaining_edge_fraction double precision,
  false_positive boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists capital_scale_runs (
  id text primary key,
  strategy_id text not null default 'ensemble',
  learner_version text,
  equity_gbp double precision not null,
  metrics jsonb not null default '{}',
  classification text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists replay_runs (
  id text primary key,
  delay_ms integer not null default 0,
  capital_profile text not null default 'research',
  fills integer not null default 0,
  rejected integer not null default 0,
  waits integer not null default 0,
  lookahead_failures integer not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists fx_quotes (
  id text primary key,
  pair text not null default 'GBPUSD',
  rate double precision not null,
  source text not null,
  observed_at timestamptz not null default now()
);

alter table paper_portfolios add column if not exists capital_profile text not null default 'research';
alter table paper_portfolios add column if not exists starting_equity_gbp double precision;
alter table paper_portfolios add column if not exists gbp_usd_rate double precision;
alter table paper_portfolios add column if not exists gbp_usd_observed_at timestamptz;

alter table trade_decision_snapshots add column if not exists latest_market_data_timestamp timestamptz;
alter table trade_decision_snapshots add column if not exists latest_news_timestamp timestamptz;
alter table trade_decision_snapshots add column if not exists latest_social_timestamp timestamptz;
alter table trade_decision_snapshots add column if not exists latest_event_timestamp timestamptz;
alter table trade_decision_snapshots add column if not exists analysis_timestamp timestamptz;
alter table trade_decision_snapshots add column if not exists capital_profile text;
alter table trade_decision_snapshots add column if not exists executable_at_100 boolean;
alter table trade_decision_snapshots add column if not exists lookahead_clean boolean not null default true;
