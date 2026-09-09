# Operations

- Ingest runs on dashboard load (stale-while-revalidate) **and** on a 3-minute desk poll
- X recent-search is **not** on that cadence. Hard caps: 8 calls/day, 48/week, 3 hours between calls, 10 tweets, one compact query
- Extra free tapes (Kraken/OKX/Coinbase/Binance/CoinCap overlays, DefiLlama TVL, mempool fees, Reddit, extra RSS, Yahoo macro, CoinPaprika) ride the same poll
- `source_health` and `ingest_runs` are the audit trail. Errors are redacted of secrets before they hit the public DTO
- X spend is stored in `system_config.x_api_budget` and `secrets/x-budget.json`
- Alerts land in-app (`alerts` table). Desk notes go out at 08:00 and 20:00 Europe/London to a private mailbox — recipient is never stored in the public schema
- LLM research is user-initiated and capped
- Paper engine: dip-buy / momentum / mean-revert / breakout / relative strength / funding squeeze for entries; hard stop, take, trail, time-cut, regime cut for exits. Social-proxy is not auto-traded
- Live execution stays compiled out

Scan capacity: CoinGecko top 100 + DexScreener boosts/profiles + new pools across 5 chains + extra CEX overlays, then a shortlist of GoPlus scans and pool-trade pulls.

X keys live in gitignored `secrets/runtime.env`. Never commit them.
