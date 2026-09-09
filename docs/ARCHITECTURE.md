# Architecture

Aether is a modular intelligence desk packaged as a single TanStack Start application so the dashboard, ingest, scoring, paper broker and research agent share one process and one Postgres-compatible database.

```
ingest (HTTP sources, retries, health)
    → normalized events / assets / news / markets
        → risk funnel (cheap filters → GoPlus on a shortlist)
            → composite ranker (source reliability adjusted)
                → event intelligence + wallet intelligence
                    → strategy registry → signals
                        → paper broker (latency, impact, fees)
                            → audit tables + dashboard
```

## Modules (`src/lib/aether`)

| Module | Role |
| --- | --- |
| `sources.ts` | CoinGecko, DexScreener, GeckoTerminal, Kraken, Coinbase, RSS, Polymarket, GoPlus, optional X |
| `http.ts` | timeouts, retries, 429 backoff |
| `scoring.ts` | explainable composite rank; source reliability discount |
| `risk.ts` | rug assessment + order limits |
| `signals.ts` | versioned strategies |
| `paper.ts` | fill model (never trades at the print) |
| `backtest.ts` | walk-forward, next-open fills, benchmark, random baseline, rolling windows |
| `events.ts` | monitored-entity event detection from news/Polymarket |
| `wallet-intelligence.ts` | Polymarket wallet scoring + paper-only copy signals |
| `live.ts` | fail-closed live gates (hard-disabled) |
| `research.ts` | user-initiated LLM, sectioned output |
| `ingest.ts` | orchestration + persistence |

## Data

Schema lives in `migrations/0002_aether.sql` plus `0003_desk_upgrade.sql` and `0004_events_wallet_intelligence.sql`. Preview uses embedded PGLite; production uses Neon/Postgres via `DATABASE_URL`. Rows are unowned (no accounts). Do not store personal data or secrets in them.

Every time-sensitive record carries `observed_at` / `source_timestamp` / `ingested_at` as available. Freshness is a feature, not a footnote.

## Funnel

1. Cheap deterministic ingest (100+ majors, new/boosted pools)
2. Quantitative scoring of the whole universe
3. Source reliability down-weighting for degraded/failing feeds
4. On-chain security only for a shortlist of DEX candidates
5. Social/news entity join + event intelligence
6. Polymarket wallet intelligence (informational copy signals)
7. LLM only when you press **Run research**

## Live trading

`evaluateLiveGates()` is fail-closed and this build sets `canSubmit = false` unconditionally. See TRADING.md.
