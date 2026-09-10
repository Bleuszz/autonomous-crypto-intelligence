-- X/Twitter market-moving intelligence add-on.
-- Unowned rows (auth is off). No secrets, no live trading.

-- Extend detected_events with X-specific latency, signal, confirmation and reaction state.
alter table detected_events
  add column if not exists latency jsonb,
  add column if not exists signal text,
  add column if not exists market_reaction text,
  add column if not exists confirmation_count integer not null default 0,
  add column if not exists contradiction_count integer not null default 0,
  add column if not exists event_status text not null default 'preliminary';

-- Lightweight storage for posts received from the X filtered stream.
-- Only watchlist accounts are ingested, and the majority are filtered out cheaply.
create table if not exists x_stream_posts (
  id text primary key,
  post_id text not null,
  username text not null,
  tier text not null,
  body text not null,
  body_hash text not null,
  event_type text,
  category text,
  affected_assets jsonb not null default '[]',
  affected_sectors jsonb not null default '[]',
  impact_score double precision not null default 0,
  confidence double precision not null default 0,
  signal text,
  market_reaction text,
  confirmation_count integer not null default 0,
  contradiction_count integer not null default 0,
  latency jsonb not null default '{}',
  published_at timestamptz,
  received_at timestamptz not null default now(),
  classified_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists x_stream_posts_user_idx on x_stream_posts (username, created_at desc);
create index if not exists x_stream_posts_impact_idx on x_stream_posts (impact_score desc, created_at desc);
create index if not exists x_stream_posts_hash_idx on x_stream_posts (body_hash, username);

-- Account-level performance statistics for watchlist ranking.
create table if not exists x_account_stats (
  username text primary key,
  tier text not null,
  posts_analysed integer not null default 0,
  market_moving_posts integer not null default 0,
  total_impact double precision not null default 0,
  precision_score double precision,
  avg_impact double precision,
  avg_lead_time_ms double precision,
  last_post_at timestamptz,
  updated_at timestamptz not null default now()
);

-- One-row stream connection health tracker.
create table if not exists x_stream_health (
  id text primary key,
  connected boolean not null default false,
  last_event_at timestamptz,
  reconnect_count integer not null default 0,
  last_error text,
  rate_limit_state text,
  updated_at timestamptz not null default now()
);
