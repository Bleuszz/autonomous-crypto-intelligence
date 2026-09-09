# Operations

- Ingest runs on demand (dashboard load / refresh) with a ~55s TTL
- `source_health` and `ingest_runs` are the audit trail
- Alerts currently land in-app (`alerts` table + toasts). Discord/Telegram wait on webhooks
- Kill switch: System page
- LLM research is user-initiated and capped

Scan capacity in v1: CoinGecko top 100 + DexScreener boosts/profiles + ~20 new pools × 5 chains, then a shortlist of 8 GoPlus scans and 6 pool-trade pulls.
