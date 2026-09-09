# Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Empty scanner | First ingest still running or CoinGecko 429 |
| STALE news only | RSS feed lagged; check source health |
| No paper fills | Confidence/liquidity/rug gates; this is normal |
| Kill switch stuck | Toggle on System; `KILL_SWITCH` env overrides on |
| Research error | `XAI_API_KEY` missing or quota |
| X empty | No bearer token / unpaid plan |
| Backtest empty | Kraken unreachable |
| Preview data gone | PGLite is in-memory — restart clears it |

Never paste secrets into a research prompt or a GitHub issue.
