# Credentials

Never commit real values. Use `.env.example` as the catalogue. Runtime secrets belong in gitignored `secrets/runtime.env`.

## Required now

None for market data. Public endpoints power majors, DEX discovery, news, Polymarket, and paper fills.

| Provider | Purpose | Free tier |
| --- | --- | --- |
| CoinGecko | Listed majors, trending | Yes (rate-limited) |
| DexScreener | Boosted / profiled tokens, pairs | Yes |
| GeckoTerminal | New pools, trades | Yes (often rate-limited) |
| GoPlus | Token security shortlist | Yes |
| Kraken | Daily OHLCV backtests | Yes |
| Coinbase Exchange | Spot marks | Yes |
| Alternative.me | Fear & Greed | Yes |
| RSS (CoinDesk, Cointelegraph, Decrypt, The Block) | News | Yes |
| Polymarket Gamma | Event discovery | Yes (public) |

## X API (imported, budgeted)

Official recent-search is **paid**. This desk is tuned so a **$5 credit lasts about a week**:

- 1 compact query `(bitcoin OR ethereum OR solana) (ETF OR breakout OR listing OR whale) …`
- `max_results=10`
- at most **8 calls/day** and **48/week**
- **3 hours** between calls
- 429 / 401 / 402 / 403 → **6 hour backoff**
- Refresh on the desk does **not** bypass the cap

Store as `X_BEARER_TOKEN` (plus optional `X_API_KEY` / `X_API_SECRET`) in `secrets/runtime.env`.

**Paste the bearer exactly as X Developer Portal shows it.** If it contains `%2F` / `%2B` / `%3D`, leave those characters in place. URI-decoding the token produces HTTP 401.

If these keys were pasted into a chat, rotate them at developer.x.com when you can.

## Optional (improves quality)

| Provider | Purpose | Where | Cost |
| --- | --- | --- | --- |
| CoinGecko Pro (`COINGECKO_API_KEY`) | Higher rate limits | coingecko.com/api | Paid |
| Alchemy / QuickNode / Helius | Full-node logs, wallets | respective dashboards | Free + paid |
| CryptoPanic / NewsAPI | Extra news | cryptopanic.com / newsapi.org | Free + paid |
| Discord webhook / Telegram bot | Alert channels | Discord/Telegram | Free |

## Required for live trading (not enabled)

Exchange keys with **withdrawals disabled**. See TRADING.md and SECURITY.md.

Do not purchase anything automatically.
