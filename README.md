# Aether

Autonomous cryptocurrency intelligence, research, and **paper-trading** platform.

Live execution is compiled out. `TRADING_MODE=PAPER` is the only path that can place orders. A viral terminal screenshot is treated as a hypothesis, not evidence.

Private repo: [github.com/Bleuszz/autonomous-crypto-intelligence](https://github.com/Bleuszz/autonomous-crypto-intelligence)

## What it does

- Discovers listed majors (CoinGecko) and newly liquid DEX pools (DexScreener, GeckoTerminal)
- Scores opportunities with explainable weights (liquidity, momentum, volume anomaly, news, social proxy, wallet prints, risk penalty) and source-reliability discounting
- Flags rug / honeypot / mint / tax characteristics via GoPlus where the chain is supported
- Ingests breaking news with NEW / RECENT / STALE bands and deduplicates/monitors entities for event intelligence
- Reads Polymarket as an information source (no causation assumed) and scores public wallet trade history
- Generates versioned strategy signals; signal deduplication includes the strategy version
- Paper-trades with latency, impact, fees and gas; P&L is tracked from completed round trips
- Walk-forward backtests on Kraken daily candles with buy-and-hold benchmark, random baseline, and rolling windows
- Optional Grok research reports split into FACT / INFERENCE / UNCERTAINTY / SPECULATION
- Official X recent-search on a hard **$5/week** budget (8 calls/day, 3 hours apart)
- Extra free tapes: OKX/Binance funding, DefiLlama TVL, mempool fees, Reddit, extra RSS, DXY/SPX/gold, CoinCap
- Private 08:00 / 20:00 Europe/London desk notes (recipient never shown on this public site)

X API keys live in gitignored `secrets/runtime.env`. The spend ledger is `secrets/x-budget.json` so a restart cannot reset the cap.

## Trading mode

| Mode | Status |
| --- | --- |
| PAPER | Default, enforced |
| LIVE | Disabled. See [docs/TRADING.md](docs/TRADING.md) |

## Run locally

See [docs/SETUP.md](docs/SETUP.md). Short path:

```bash
git clone git@github.com:Bleuszz/autonomous-crypto-intelligence.git
cd autonomous-crypto-intelligence
npm install
# optional: copy X keys into gitignored secrets/runtime.env (paste bearer as-is)
npm run dev
```

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Setup](docs/SETUP.md)
- [API keys](docs/API_KEYS.md)
- [Security](docs/SECURITY.md)
- [Trading (live, disabled)](docs/TRADING.md)
- [Paper trading](docs/PAPER_TRADING.md)
- [Backtesting](docs/BACKTESTING.md)
- [Data sources](docs/DATA_SOURCES.md)
- [Strategies](docs/STRATEGIES.md)
- [Operations](docs/OPERATIONS.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Event + Wallet Intelligence](docs/EVENTS_WALLET_INTELLIGENCE.md)

## Honesty

Paper P&L is simulated. Backtests are descriptive. No strategy is promoted because it looks good on a screenshot.
