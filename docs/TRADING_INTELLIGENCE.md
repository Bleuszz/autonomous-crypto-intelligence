# Trading Intelligence Engine

Version: `ti-0.1.0`

Technical evidence for the existing paper desk. It does **not** replace scoring, events, X, Polymarket, risk, or the learner. Live execution stays compiled out.

```
RAW MARKET DATA
  → MARKET STRUCTURE
  → TECHNICAL INDICATORS
  → VOLUME / VOLATILITY
  → LIQUIDITY / ORDER FLOW
  → MULTI-TIMEFRAME ANALYSIS
  → EVENT / NEWS / SOCIAL / POLYMARKET
  → SIGNAL CONFLICT ANALYSIS
  → RISK ENGINE (authoritative)
  → TRADING INTELLIGENCE (ENTER / WAIT / REJECT evidence)
  → £100K PAPER EXECUTION
  → LEARNING ENGINE
```

## Contract

- Indicators only use candles with `close time <= decision timestamp`.
- Missing book / CVD / walls / liquidations are `UNAVAILABLE`, never `0`.
- Hard risk, stale-data, liquidity, exposure, drawdown and capital gates stay authoritative.
- Technical evidence may veto or delay a buy (`WAIT` / `REJECT`). It never invents an entry the desk did not propose.
- Ablation and walk-forward helpers report `INSUFFICIENT EVIDENCE` when the sample is too small. This build does not claim that RSI or any other indicator improves expectancy.

## Indicators

Complementary set only: RSI, MACD, EMA-21, SMA-20, ATR-14, Bollinger 20/2, VWAP (when volume exists), ADX-14, OBV (when volume exists). Each reading stores timeframe, timestamp, window, version, freshness and source.

## Capital

- Research book: **£100,000** — active paper laboratory, many simultaneous legitimate positions when opportunities exist.
- Realistic gate: **£100** — fees, min size, liquidity, utilisation.
- A strategy that works at £100k and cannot place £100 tickets is `CAPITAL-SCALE DEPENDENT — NOT DEPLOYMENT READY`.

## Dashboard

`/trading` shows structure, indicators, S/R, volume/liquidity availability, conflict scores, the technical decision, and the dual capital reminder. Empty tapes render `NO DATA` / `UNAVAILABLE`.

## Learning dashboard reliability

`learner_recommendation` JSON-null / missing `action` is coerced to `WAIT` + `NO DATA` in `src/lib/aether/learning/recommendation.ts`. Wire `loadLearnerPredictions` through `coerceLearnerRecommendation` so a single malformed snapshot cannot crash `/learning`.
