# Data sources

| Source | Used for | Auth |
| --- | --- | --- |
| CoinGecko | Majors, sparkline, trending, BTC dominance | Public |
| DexScreener | Boosts, profiles, pair stats, social links | Public |
| GeckoTerminal | New pools, large trades | Public |
| GoPlus | Honeypot, tax, mint, freeze, holders | Public |
| Kraken | Daily OHLCV | Public |
| Coinbase | BTC/ETH/SOL spot overlay | Public |
| Alternative.me | Fear & Greed | Public |
| RSS | CoinDesk, Cointelegraph, Decrypt, The Block | Public |
| Polymarket Gamma | Events, probabilities, volume | Public |
| X recent search | Optional posts | Bearer, paid plan |

Binance REST is geo-blocked in this environment; Kraken/Coinbase are the CEX fallbacks.

X is a proxy until `X_BEARER_TOKEN` is set. Social posts are not treated as ground truth.

RPC providers (Alchemy, Helius, QuickNode) are optional upgrades for deeper wallet history.
