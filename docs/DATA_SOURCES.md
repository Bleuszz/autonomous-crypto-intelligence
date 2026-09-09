# Data sources

| Source | Used for | Auth |
| --- | --- | --- |
| CoinGecko | Majors, sparkline, trending, BTC dominance, categories | Public |
| DexScreener | Boosts, profiles, pair stats, social links | Public |
| GeckoTerminal | New pools, large trades | Public |
| GoPlus | Honeypot, tax, mint, freeze, holders | Public |
| Kraken | Daily OHLCV + spot ticker overlay | Public |
| Coinbase | BTC/ETH/SOL + extra USD pairs | Public |
| OKX | Spot overlay + BTC/ETH perp funding | Public |
| DefiLlama | Chain TVL, stablecoin float | Public |
| mempool.space | Fastest fee, hashrate | Public |
| CoinPaprika | Global cap / volume | Public |
| blockchain.info | Height / next-halving estimate | Public |
| Yahoo Finance | DXY, SPX, gold | Public |
| Reddit JSON | r/CryptoCurrency, bitcoin, ethereum, solana hot | Public |
| Alternative.me | Fear & Greed | Public |
| RSS | CoinDesk, Cointelegraph, Decrypt, The Block, Bitcoin Magazine, CryptoSlate, Blockworks, The Defiant, Ethereum blog, Solana status | Public |
| Polymarket Gamma | Events, probabilities, volume | Public |
| Binance spot + usdt-m premiumIndex | Last print / 24h / funding (often geo-blocked here; then ignored) | Public |
| CoinCap | Extra major last prints | Public |
| X recent search | Optional posts | Bearer, paid plan |

Venue last-prints overlay CoinGecko marks and refresh `observedAt` so the paper book is not stuck on a stale `last_updated`. Binance is tried; Kraken / Coinbase / OKX / CoinCap cover the same names if it is blocked.

X is a proxy until `X_BEARER_TOKEN` is set. Social posts are not treated as ground truth.

RPC providers (Alchemy, Helius, QuickNode) are optional upgrades for deeper wallet history.
