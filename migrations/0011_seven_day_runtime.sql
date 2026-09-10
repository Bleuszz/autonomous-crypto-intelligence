-- Durable runtime/experiment checkpoints for the seven-day local deployment.

create table if not exists runtime_heartbeats (
  job text primary key,
  status text not null,
  process_id text,
  started_at timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  details jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists experiments (
  id text primary key,
  started_at timestamptz not null default now(),
  starting_equity_usd double precision not null,
  starting_open_positions integer not null,
  starting_completed_trades integer not null,
  starting_resolved_experiences integer not null,
  application_commit text not null,
  strategy_version text,
  learner_version text,
  configuration_version text not null,
  interruption_count integer not null default 0,
  last_recovered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists data_gaps (
  id text primary key,
  experiment_id text references experiments(id) on delete set null,
  source text not null,
  gap_start timestamptz not null,
  gap_end timestamptz not null,
  duration_seconds integer not null,
  recovery text not null default 'UNAVAILABLE',
  notes text,
  created_at timestamptz not null default now(),
  unique (source, gap_start, gap_end)
);

create index if not exists data_gaps_experiment_idx on data_gaps (experiment_id, gap_start desc);
