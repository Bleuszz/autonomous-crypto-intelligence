-- X/Twitter market-moving event learning/feedback table.
-- Stores high-impact X events for historical outcome tracking and account ranking.
-- Unowned rows (auth is off). No secrets, no live trading.

create table if not exists x_learning (
  id text primary key,
  post_id text not null,
  username text not null,
  tier text not null,
  event_type text not null,
  category text not null,
  affected_assets jsonb not null default '[]',
  impact_score double precision not null default 0,
  confidence double precision not null default 0,
  detection_latency_ms double precision,
  market_state text,
  signal text not null,
  market_reaction text not null,
  event_outcome text,
  reward double precision,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists x_learning_user_idx on x_learning (username, created_at desc);
create index if not exists x_learning_signal_idx on x_learning (signal, created_at desc);
