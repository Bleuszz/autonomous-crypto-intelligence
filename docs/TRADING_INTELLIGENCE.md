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

## Capital

- Research book: **£100,000** — active paper laboratory, many simultaneous legitimate positions when opportunities exist.
- Realistic gate: **£100** — fees, min size, liquidity, utilisation.
- A strategy that works at £100k and cannot place £100 tickets is `CAPITAL-SCALE DEPENDENT — NOT DEPLOYMENT READY`.

## Dashboard

`/trading` shows structure, indicators, S/R, volume/liquidity availability, conflict scores, the technical decision, and the dual capital reminder. Empty tapes render `NO DATA` / `UNAVAILABLE`.
