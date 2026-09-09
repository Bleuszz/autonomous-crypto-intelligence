# Operations

- Ingest runs on dashboard load (stale-while-revalidate) **and** on a 3-minute desk poll
- X recent-search is **not** on that cadence. Hard caps: 8 calls/day, 48/week, 3 hours between calls, 10 tweets, one compact query
- `source_health` and `ingest_runs` are the audit trail
- X spend is stored in `system_config.x_api_budget`
- Alerts currently land in-app (`alerts` table + toasts). Discord/Telegram wait on webhooks
- Kill switch: System page
- LLM research is user-initiated and capped
- Paper auto-entries ignore social-proxy signals, require a fresh mark, liquidity, and a cap of 2 new positions per cycle
- Live execution stays compiled out

Scan capacity in v1: CoinGecko top 100 + DexScreener boosts/profiles + new pools across 5 chains, then a shortlist of GoPlus scans and pool-trade pulls.

X keys live in gitignored `secrets/runtime.env`. Never commit them.
