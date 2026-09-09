-- Aether intelligence schema. Unowned rows (auth is off). Idempotent.

create table if not exists chains (
  id text primary key,
  name text not null,
  native_symbol text,
  explorer_url text,
  created_at timestamptz not null default now()
);

create table if not exists assets (
  id text primary key,
  symbol text not null,
  name text not null,
  kind text not null default 'unknown',
  chain_id text,
  contract_address text,
  coingecko_id text,
  image_url text,
  decimals integer,
  price_usd double precision,
  market_cap_usd double precision,
  fdv_usd double precision,
  volume_24h_usd double precision,
  liquidity_usd double precision,
  change_1h_pct double precision,
  change_24h_pct double precision,
  change_7d_pct double precision,
  pair_created_at timestamptz,
  holders integer,
  sparkline_7d jsonb,
  source text,
  source_reliability double precision not null default 0.5,
  observed_at timestamptz,
  source_timestamp timestamptz,
  ingested_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists assets_symbol_idx on assets (symbol);
create index if not exists assets_chain_idx on assets (chain_id);
create index if not exists assets_kind_idx on assets (kind);

create table if not exists contracts (
  id text primary key,
  asset_id text not null,
  chain_id text not null,
  address text not null,
  is_proxy boolean,
  is_open_source boolean,
  owner_address text,
  mint_authority text,
  freeze_authority text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pools (
  id text primary key,
  asset_id text,
  chain_id text,
  address text,
  dex text,
  name text,
  base_token text,
  quote_token text,
  liquidity_usd double precision,
  volume_24h_usd double precision,
  volume_1h_usd double precision,
  volume_5m_usd double precision,
  txns_24h integer,
  buys_24h integer,
  sells_24h integer,
  price_usd double precision,
  fdv_usd double precision,
  created_at timestamptz,
  observed_at timestamptz,
  ingested_at timestamptz not null default now(),
  source text
);
create index if not exists pools_asset_idx on pools (asset_id);

create table if not exists candles (
  id text primary key,
  asset_id text not null,
  venue text not null,
  timeframe text not null,
  open_time timestamptz not null,
  open double precision not null,
  high double precision not null,
  low double precision not null,
  close double precision not null,
  volume double precision,
  ingested_at timestamptz not null default now(),
  unique (asset_id, venue, timeframe, open_time)
);
create index if not exists candles_asset_tf_idx on candles (asset_id, timeframe, open_time);

create table if not exists liquidity_snapshots (
  id text primary key,
  pool_id text not null,
  liquidity_usd double precision,
  observed_at timestamptz not null,
  ingested_at timestamptz not null default now()
);

create table if not exists volume_snapshots (
  id text primary key,
  asset_id text not null,
  volume_usd double precision,
  bucket text not null,
  observed_at timestamptz not null,
  ingested_at timestamptz not null default now()
);

create table if not exists wallets (
  id text primary key,
  chain_id text not null,
  address text not null,
  label text,
  classification text not null default 'unknown',
  confidence double precision not null default 0,
  notes text,
  first_seen timestamptz,
  last_seen timestamptz,
  created_at timestamptz not null default now(),
  unique (chain_id, address)
);

create table if not exists wallet_labels (
  id text primary key,
  wallet_id text not null,
  label text not null,
  source text,
  created_at timestamptz not null default now()
);

create table if not exists wallet_transactions (
  id text primary key,
  wallet_id text,
  chain_id text,
  tx_hash text,
  asset_id text,
  side text,
  amount double precision,
  price_usd double precision,
  notional_usd double precision,
  observed_at timestamptz,
  source_timestamp timestamptz,
  ingested_at timestamptz not null default now(),
  source text
);
create index if not exists wallet_tx_wallet_idx on wallet_transactions (wallet_id, observed_at desc);

create table if not exists wallet_performance (
  wallet_id text primary key,
  n_trades integer not null default 0,
  win_rate double precision,
  avg_pnl_pct double precision,
  realized_pnl_usd double precision,
  max_drawdown_pct double precision,
  last_evaluated_at timestamptz
);

create table if not exists social_posts (
  id text primary key,
  platform text not null,
  author text,
  author_id text,
  url text,
  body text,
  engagement integer,
  source_reliability double precision not null default 0.4,
  bot_likelihood double precision,
  entities jsonb,
  published_at timestamptz,
  observed_at timestamptz,
  ingested_at timestamptz not null default now(),
  freshness text
);
create index if not exists social_posts_pub_idx on social_posts (published_at desc);

create table if not exists news_articles (
  id text primary key,
  source text not null,
  source_reliability double precision not null default 0.6,
  title text not null,
  url text,
  summary text,
  entities jsonb,
  sentiment double precision,
  published_at timestamptz,
  observed_at timestamptz,
  ingested_at timestamptz not null default now(),
  freshness text
);
create index if not exists news_pub_idx on news_articles (published_at desc);

create table if not exists polymarket_markets (
  id text primary key,
  event_id text,
  slug text,
  question text not null,
  category text,
  end_date timestamptz,
  closed boolean not null default false,
  volume double precision,
  volume_24h double precision,
  liquidity double precision,
  probability double precision,
  probability_24h_ago double precision,
  outcomes jsonb,
  url text,
  observed_at timestamptz,
  ingested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists polymarket_prices (
  id text primary key,
  market_id text not null,
  probability double precision,
  observed_at timestamptz not null,
  ingested_at timestamptz not null default now()
);

create table if not exists events (
  id text primary key,
  asset_id text,
  type text not null,
  timestamp timestamptz not null,
  source text,
  source_reliability double precision,
  headline text,
  payload jsonb,
  sentiment double precision,
  market_relevance double precision,
  freshness double precision,
  ingested_at timestamptz not null default now()
);
create index if not exists events_ts_idx on events (timestamp desc);

create table if not exists signals (
  id text primary key,
  strategy_id text not null,
  strategy_version text not null,
  asset_id text not null,
  side text not null,
  confidence double precision not null,
  opportunity_score double precision,
  status text not null default 'open',
  entry_mid double precision,
  invalidation double precision,
  expected_horizon text,
  created_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  closed_at timestamptz,
  explanation jsonb
);
create index if not exists signals_open_idx on signals (status, created_at desc);

create table if not exists signal_explanations (
  id text primary key,
  signal_id text not null,
  kind text not null,
  detail text not null,
  weight double precision
);

create table if not exists strategies (
  id text primary key,
  name text not null,
  version text not null,
  description text,
  params jsonb not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, version)
);

create table if not exists paper_portfolios (
  id text primary key,
  name text not null,
  starting_equity_usd double precision not null,
  cash_usd double precision not null,
  equity_usd double precision not null,
  realized_pnl_usd double precision not null default 0,
  peak_equity_usd double precision not null,
  max_drawdown_pct double precision not null default 0,
  day_pnl_usd double precision not null default 0,
  day_anchor_equity_usd double precision,
  day_anchor_date text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists paper_orders (
  id text primary key,
  portfolio_id text not null,
  signal_id text,
  asset_id text not null,
  side text not null,
  type text not null default 'market',
  status text not null,
  requested_notional_usd double precision not null,
  requested_qty double precision,
  submitted_at timestamptz not null default now(),
  available_at timestamptz not null,
  reason text,
  latency_ms integer,
  assumed_mid double precision,
  notes jsonb
);

create table if not exists paper_fills (
  id text primary key,
  order_id text not null,
  portfolio_id text not null,
  asset_id text not null,
  side text not null,
  qty double precision not null,
  price double precision not null,
  notional_usd double precision not null,
  fee_usd double precision not null,
  slippage_bps double precision not null,
  gas_usd double precision not null default 0,
  filled_at timestamptz not null default now(),
  model text not null
);

create table if not exists positions (
  id text primary key,
  portfolio_id text not null,
  asset_id text not null,
  qty double precision not null,
  avg_price double precision not null,
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  stop_loss double precision,
  take_profit double precision,
  unique (portfolio_id, asset_id)
);

create table if not exists portfolio_snapshots (
  id text primary key,
  portfolio_id text not null,
  equity_usd double precision not null,
  cash_usd double precision not null,
  realized_pnl_usd double precision,
  unrealized_pnl_usd double precision,
  drawdown_pct double precision,
  observed_at timestamptz not null default now()
);
create index if not exists portfolio_snap_idx on portfolio_snapshots (portfolio_id, observed_at);

create table if not exists backtest_runs (
  id text primary key,
  strategy_id text not null,
  strategy_version text not null,
  params jsonb,
  venue text,
  asset_id text,
  timeframe text,
  start_time timestamptz,
  end_time timestamptz,
  in_sample boolean,
  walk_forward boolean,
  metrics jsonb not null,
  equity_curve jsonb,
  trades jsonb,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists risk_events (
  id text primary key,
  asset_id text,
  wallet_id text,
  severity text not null,
  kind text not null,
  score double precision,
  reasons jsonb,
  observed_at timestamptz not null default now(),
  ingested_at timestamptz not null default now()
);

create table if not exists source_health (
  id text primary key,
  source text not null unique,
  status text not null,
  latency_ms integer,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  calls integer not null default 0,
  failures integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists ingest_runs (
  id text primary key,
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null,
  assets_upserted integer,
  signals_created integer,
  errors jsonb,
  duration_ms integer
);

create table if not exists alerts (
  id text primary key,
  kind text not null,
  severity text not null,
  title text not null,
  body text,
  asset_id text,
  payload jsonb,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  channel text
);

create table if not exists research_reports (
  id text primary key,
  asset_id text not null,
  model text,
  fact text,
  inference text,
  uncertainty text,
  speculation text,
  raw text,
  created_at timestamptz not null default now()
);

create table if not exists system_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists opportunity_ranks (
  asset_id text primary key,
  score double precision not null,
  components jsonb not null,
  reasons jsonb not null,
  rug_risk double precision,
  confidence double precision,
  updated_at timestamptz not null default now()
);

insert into chains (id, name, native_symbol, explorer_url) values
  ('ethereum', 'Ethereum', 'ETH', 'https://etherscan.io'),
  ('solana', 'Solana', 'SOL', 'https://solscan.io'),
  ('base', 'Base', 'ETH', 'https://basescan.org'),
  ('bsc', 'BNB Chain', 'BNB', 'https://bscscan.com'),
  ('arbitrum', 'Arbitrum', 'ETH', 'https://arbiscan.io'),
  ('polygon', 'Polygon', 'MATIC', 'https://polygonscan.com')
on conflict (id) do nothing;

insert into paper_portfolios (
  id, name, starting_equity_usd, cash_usd, equity_usd, peak_equity_usd, day_anchor_equity_usd
) values (
  'paper-default', 'Default paper desk', 10000, 10000, 10000, 10000, 10000
) on conflict (id) do nothing;

insert into system_config (key, value) values
  ('trading_mode', '"PAPER"'),
  ('enable_live_trading', 'false'),
  ('kill_switch', 'false'),
  ('score_weights', '{"marketQuality":0.20,"liquidity":0.15,"momentum":0.15,"volumeAnomaly":0.10,"smartMoney":0.15,"social":0.10,"news":0.10}'),
  ('risk_limits', '{"maxPositionPct":0.10,"maxDailyLossPct":0.08,"maxTokenConcentrationPct":0.25,"maxChainExposurePct":0.50,"maxLiquidityTakePct":0.02,"maxSlippageBps":150,"maxTradeLossPct":0.04}'),
  ('paper_fees', '{"dexFeeBps":30,"gasUsdEth":2.5,"gasUsdL2":0.15,"gasUsdSol":0.02,"baseSlippageBps":8,"latencyMsMin":1500,"latencyMsMax":9000}')
on conflict (key) do nothing;

insert into strategies (id, name, version, description, params, enabled) values
  ('momentum_v1', 'Momentum confirmation', '1.0.0', 'Price acceleration plus volume confirmation plus minimum liquidity.', '{"minLiqUsd":75000,"minVolUsd":40000,"min1h":1.2,"min24h":4,"maxRug":0.55,"minConfidence":0.58}', true),
  ('discovery_liquidity_v1', 'New-liquidity discovery', '1.0.0', 'Newly liquid pairs with rising volume. Heavily penalises thin books and mint risk.', '{"maxAgeHours":72,"minLiqUsd":40000,"minVolUsd":25000,"maxRug":0.45,"minConfidence":0.6}', true),
  ('news_reaction_v1', 'News reaction', '1.0.0', 'Breaking news linked to an asset, confirmed by short-horizon volume/price.', '{"maxNewsAgeMin":180,"minRelevance":0.5,"minConfidence":0.6}', true),
  ('social_proxy_v1', 'Social acceleration (proxy)', '1.0.0', 'Trending-search and mention-proxy acceleration. Not a substitute for X firehose.', '{"minConfidence":0.55}', true),
  ('polymarket_macro_v1', 'Cross-market information', '1.0.0', 'Sharp Polymarket probability moves coincident with crypto beta. No causation assumed.', '{"minAbsProbMove":0.06,"minConfidence":0.55}', true),
  ('smart_money_follow_v1', 'Qualified wallet follow', '1.0.0', 'Copy-trade only wallets that already have a scored track record. Conservative defaults.', '{"minWalletConfidence":0.7,"minLiqUsd":100000,"latencyMs":4000,"minConfidence":0.62}', true)
on conflict (id) do nothing;
