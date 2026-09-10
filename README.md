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
- Reward + adaptive learning engine: immutable decision/outcome snapshots, normalized reward decomposition, feature attribution, pattern discovery with sample-size gating, shadow-mode contextual learner, champion/challenger promotion pipeline with rollback
- Optional Grok research reports split into FACT / INFERENCE / UNCERTAINTY / SPECULATION
- Optional real-time X filtered-stream monitoring of a compact, high-value, tiered watchlist with market-impact scoring and latency measurement
- Extra free tapes: OKX/Binance funding, DefiLlama TVL, mempool fees, Reddit, extra RSS, DXY/SPX/gold, CoinCap
- Private 08:00 / 20:00 Europe/London desk notes (recipient never shown on this public site)

X API keys live in gitignored `secrets/runtime.env`. The spend ledger is `secrets/x-budget.json` so a restart cannot reset the cap.

## Learner controls

The `/learning` dashboard is the control centre for the adaptive learner. It shows prediction counts, accuracy by action and confidence, reward analytics, regime/asset breakdowns, pattern intelligence, champion/challenger status, and a password-protected control panel.

The learner can be in one of three server-persisted states:

| State | Behaviour |
| --- | --- |
| `DISABLED` | Learner is not consulted; baseline deterministic system runs normally. |
| `SHADOW` (default) | Learner records predictions and evaluates them, but does not influence paper trades. |
| `ACTIVE` | Learner may override the paper-trading decision layer (currently `ENTER` → `REJECT`/`WAIT`) while still passing hard risk gates first. Live execution remains impossible. |

State changes on `/learning` require the server-side control password. The password is read from `LEARNING_CONTROL_PASSWORD`; for local/private use the documented default is `1234` when no env var is set. The password is never rendered, logged, stored in the database, or sent to the browser. Change attempts are written to `learner_control_audit` without the password.

See [docs/LEARNING.md](docs/LEARNING.md) for the full metrics reference.

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
- [Reward + Adaptive Learning Engine](docs/LEARNING.md)
- [X/Twitter Market-Moving Intelligence](docs/X_MARKET_INTELLIGENCE.md)

## Honesty

Paper P&L is simulated. Backtests are descriptive. No strategy is promoted because it looks good on a screenshot.
