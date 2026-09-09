# Credentials

Never commit real values. Use `.env.example` as the catalogue.

## Required now

None. Public endpoints power the first version:

| Provider | Purpose | Free tier |
| --- | --- | --- |
| CoinGecko | Listed majors, trending | Yes (rate-limited) |
| DexScreener | Boosted / profiled tokens, pairs | Yes |
| GeckoTerminal | New pools, trades | Yes |
| GoPlus | Token security shortlist | Yes |
| Kraken | Daily OHLCV backtests | Yes |
| Coinbase Exchange | Spot marks | Yes |
| Alternative.me | Fear & Greed | Yes |
| RSS (CoinDesk, Cointelegraph, Decrypt, The Block) | News | Yes |
| Polymarket Gamma | Event discovery | Yes (public) |

## Optional (improves quality)

| Provider | Purpose | Where | Cost |
| --- | --- | --- | --- |
| **X API bearer** (`X_BEARER_TOKEN`) | Official recent search | developer.x.com | Paid (Basic+). Free tier does not include recent search. |
| CoinGecko Pro (`COINGECKO_API_KEY`) | Higher rate limits, 1s ticks | coingecko.com/api | Paid |
| CoinMarketCap | Alternate market cap | coinmarketcap.com/api | Free + paid |
| Alchemy / QuickNode / Helius | Full-node logs, wallets | respective dashboards | Free + paid |
| CryptoPanic / NewsAPI | Extra news | cryptopanic.com / newsapi.org | Free + paid |
| Discord webhook / Telegram bot | Alert channels | Discord/Telegram | Free |

## Required for live trading (not enabled)

Exchange keys with **withdrawals disabled**. Hardware wallet or dedicated hot wallet. See TRADING.md and SECURITY.md.

Do not purchase anything automatically. Minimum to run v1: **zero paid keys**.
