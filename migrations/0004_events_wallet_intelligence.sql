-- Event intelligence + Polymarket wallet intelligence add-on.
-- Unowned rows (auth is off). No personal data or secrets.

-- Monitored entities for event detection (political figures, institutions, agencies).
create table if not exists monitored_entities (
  id text primary key,
  name text not null,
  kind text not null, -- 'person', 'institution', 'regulator', 'event_type'
  aliases jsonb not null default '[]',
  keywords jsonb not null default '[]',
  credibility double precision not null default 0.5,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Detected market-moving events.
create table if not exists detected_events (
  id text primary key,
  source text not null,
  source_reliability double precision not null default 0.5,
  author text,
  entity_id text references monitored_entities(id) on delete set null,
  title text not null,
  url text,
  raw_text text,
  event_type text not null default 'statement',
  category text not null default 'general',
  affected_assets jsonb not null default '[]',
  sentiment double precision, -- -1 to 1
  novelty double precision not null default 0,
  credibility double precision not null default 0,
  market_relevance double precision not null default 0,
  impact_score double precision not null default 0,
  confidence double precision not null default 0,
  historical_context text,
  supporting_sources jsonb not null default '[]',
  contradictory_sources jsonb not null default '[]',
  published_at timestamptz,
  observed_at timestamptz not null default now(),
  ingested_at timestamptz not null default now()
);
create index if not exists detected_events_pub_idx on detected_events (published_at desc);
create index if not exists detected_events_entity_idx on detected_events (entity_id);

-- Market reaction after events for historical learning.
create table if not exists event_asset_reactions (
  id text primary key,
  event_id text not null references detected_events(id) on delete cascade,
  asset_id text not null,
  horizon_minutes integer not null,
  start_price double precision,
  end_price double precision,
  return_pct double precision,
  volatility_pct double precision,
  volume_change_pct double precision,
  direction text,
  observed_at timestamptz not null default now(),
  unique (event_id, asset_id, horizon_minutes)
);
create index if not exists event_asset_reactions_event_idx on event_asset_reactions (event_id);
create index if not exists event_asset_reactions_asset_idx on event_asset_reactions (asset_id);

-- Polymarket wallet trades observed from the public Data API.
create table if not exists polymarket_wallet_trades (
  id text primary key,
  wallet_id text not null,
  chain_id text not null default 'polygon',
  address text not null,
  tx_hash text,
  market_id text,
  condition_id text,
  event_slug text,
  market_title text,
  outcome text,
  side text not null,
  size double precision not null,
  price double precision not null,
  notional_usd double precision,
  timestamp timestamptz not null,
  observed_at timestamptz not null default now(),
  source text not null default 'polymarket_data_api'
);
create index if not exists polymarket_wallet_trades_wallet_idx on polymarket_wallet_trades (wallet_id, timestamp desc);
create index if not exists polymarket_wallet_trades_market_idx on polymarket_wallet_trades (market_id, timestamp desc);
create index if not exists polymarket_wallet_trades_ts_idx on polymarket_wallet_trades (timestamp desc);

-- Wallet performance derived from Polymarket history.
create table if not exists wallet_performance_v2 (
  wallet_id text primary key,
  address text not null,
  chain_id text not null default 'polygon',
  n_trades integer not null default 0,
  n_wins integer not null default 0,
  n_losses integer not null default 0,
  win_rate double precision,
  avg_return_pct double precision,
  median_return_pct double precision,
  avg_win_pct double precision,
  avg_loss_pct double precision,
  payoff_ratio double precision,
  profit_factor double precision,
  realized_pnl_usd double precision,
  max_drawdown_pct double precision,
  avg_holding_hours double precision,
  recent_n_trades integer not null default 0,
  recent_return_pct double precision,
  category_performance jsonb not null default '{}',
  quality_score double precision not null default 0,
  score_reasons jsonb not null default '[]',
  first_seen timestamptz,
  last_seen timestamptz,
  updated_at timestamptz not null default now()
);

-- Copy signals from observed wallets (paper only).
create table if not exists copy_signals (
  id text primary key,
  wallet_id text not null,
  market_id text,
  asset_id text,
  side text not null,
  wallet_quality_score double precision not null,
  copy_confidence double precision not null,
  source_trade_id text,
  source_trade_timestamp timestamptz,
  observed_at timestamptz not null,
  latency_seconds double precision,
  expected_value double precision,
  status text not null default 'open',
  reasons jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index if not exists copy_signals_status_idx on copy_signals (status, created_at desc);

-- Seed monitored entities.
insert into monitored_entities (id, name, kind, aliases, keywords, credibility) values
  ('trump', 'Donald Trump', 'person', '["trump", "donald trump"]', '["trump", "donald"]', 0.7),
  ('fed', 'Federal Reserve', 'institution', '["fed", "federal reserve", "fomc"]', '["fed", "federal reserve", "fomc", "interest rate", "rate decision"]', 0.9),
  ('sec', 'US Securities and Exchange Commission', 'institution', '["sec"]', '["sec", "securities", "etf", "approval"]', 0.85),
  ('us_gov', 'US Government', 'institution', '["white house", "us government", "biden", "administration"]', '["white house", "executive order", "sanctions", "tariffs"]', 0.75),
  ('etf', 'ETF Approval', 'event_type', '["etf"]', '["etf", "spot etf", "approval"]', 0.8),
  ('hack', 'Exchange/Protocol Hack', 'event_type', '["hack", "exploit", "breach"]', '["hack", "exploit", "breach", " drained"]', 0.7),
  ('regulation', 'Regulatory Action', 'event_type', '["regulation", "sanctions", "ban"]', '["regulation", "sanctions", "ban", "illegal"]', 0.75)
on conflict (id) do nothing;
