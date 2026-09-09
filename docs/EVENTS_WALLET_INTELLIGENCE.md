# Event intelligence + Polymarket wallet intelligence

## What it does

Two new intelligence layers were added to Aether:

1. **Event intelligence** (`src/lib/aether/events.ts`) scans news, social text, and Polymarket probability jumps for mentions of monitored entities (Fed, SEC, Trump, ETF, hacks, regulation, etc.). It produces a scored `DetectedEvent` with:
   - entity detection
   - sentiment estimate
   - novelty vs recently detected events
   - market relevance to tracked crypto assets
   - credibility (source reliability + entity reliability)
   - impact and confidence scores

2. **Polymarket wallet intelligence** (`src/lib/aether/wallet-intelligence.ts`) pulls the public `data-api.polymarket.com/trades` tape, reconstructs wallet-level trade history, and computes a quality score from win rate, payoff ratio, profit factor, drawdown, recency, and category edge. Wallets with a score above the threshold feed a **paper-only copy-signal** list. The signal includes latency from the observed print and an expected-value estimate.

Both modules are integrated into the ingest pipeline (`src/lib/aether/ingest.ts`) and exposed on two new dashboard routes:
- `/events` — detected market-moving events
- `/copy-signals` — qualified wallet copy signals (information only)

## Paper-only safety

- Copy signals are **never executed automatically**. They appear on the dashboard for inspection only.
- The existing paper engine remains the only execution path; live gates are still hard-disabled.
- Wallet addresses are shortened for display. No private keys, no signatures, no real-money orders.

## Data sources used

- Polymarket Gamma API — market metadata and probabilities
- Polymarket Data API — public trade tape and wallet positions (no auth required)
- News/RSS feeds already ingested by Aether
- Social posts already ingested by Aether

## Historical learning

`evaluateWalletPerformance` uses sequential fills per wallet to estimate round-trip returns. `generateCopySignals` only emits signals for wallets that have a sufficient track record and recent activity. The system intentionally penalizes small samples.

## Limitations

- Polymarket markets are mostly non-crypto (politics, sports, macro). Crypto relevance is a cross-reference heuristic, not causation.
- Copying at the observed print is delayed and modeled with the same latency/impact/fees as any paper trade.
- A wallet that got lucky on a few markets can score high; treat quality scores as descriptive, not predictive.
