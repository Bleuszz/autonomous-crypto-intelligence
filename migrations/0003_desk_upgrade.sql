-- Desk upgrade: paper high-water, digest archive, extra strategies.
-- Unowned. No emails, keys, or personal identifiers.

alter table positions add column if not exists peak_mark_usd double precision;
alter table positions add column if not exists last_mark_usd double precision;

create table if not exists digest_reports (
  id text primary key,
  slot text not null,
  generated_at timestamptz not null default now(),
  subject text not null,
  body_text text not null,
  created_at timestamptz not null default now()
);

insert into strategies (id, name, version, description, params, enabled) values
  ('core_beta_v2', 'Core BTC/ETH sleeve', '2.0.0', 'Empty-book mixed-regime inventory in BTC/ETH. Not a directional call.', '{"maxAbs24h":6}', true),
  ('momentum_v2', 'Confirmed momentum', '2.0.0', '1h and 24h acceleration with volume, capped 24h so memes are not chased.', '{"min1h":0.45,"min24h":1.1,"max24h":22}', true),
  ('mean_revert_v2', 'Oversold mean revert', '2.0.0', 'Majors down hard with a lifting short-horizon spark.', '{"min24h":-6}', true),
  ('breakout_v2', 'Range breakout', '2.0.0', 'Holding 7d spark highs with rising tape.', '{"distFromHighPct":1.2}', true),
  ('rel_strength_v2', 'BTC-relative strength', '2.0.0', 'Liquid names beating BTC without being a vertical candle.', '{"minOutperformPp":2.8}', true),
  ('funding_squeeze_v2', 'Funding squeeze', '2.0.0', 'Very negative BTC perp funding — paper hypothesis only.', '{"maxFundingPct":-0.015}', true),
  ('momentum_fade_v2', 'Momentum fade (sell)', '2.0.0', '1h reversal after an extended 24h — exits inventory, does not short.', '{}', true),
  ('exit_stop_v2', 'Hard stop', '2.0.0', 'Engineered exit. Majors ~4.5%, DEX ~7%.', '{}', true),
  ('exit_take_v2', 'Take profit', '2.0.0', 'Engineered exit. Majors ~7%, DEX ~12%.', '{}', true),
  ('exit_trail_v2', 'Trailing stop', '2.0.0', 'Off peak after the trail is armed.', '{}', true),
  ('exit_macro_v2', 'Macro cut', '2.0.0', 'DXY bid while alts are not working — inventory cut, not a short.', '{}', true)
on conflict (id) do nothing;

insert into system_config (key, value) values
  ('digest_schedule', '{"timezone":"Europe/London","hours":[8,20]}'),
  ('paper_engine', '{"maxOpenPositions":6,"maxNewPerCycle":4}')
on conflict (key) do nothing;

delete from system_config where key = 'kill_switch';
