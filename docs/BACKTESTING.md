# Backtesting

Engine: `src/lib/aether/backtest.ts`.

- Signal at bar `i` uses `close[i]` vs `close[i-lookback]` only
- Buy fills at **next bar open**
- Sell fills at this bar close
- Fees + slippage on both sides
- Walk-forward: 70% in-sample, 30% out-of-sample; the dashboard reports **OOS** metrics
- Full-sample equity is shown for inspection and must not be used for selection

Metrics: total return, annualized (when the window is long enough), Sharpe, Sortino, max drawdown, win rate, profit factor, average/median trade, exposure, fees, best/worst, consecutive losses.

Too few trades → treat Sharpe as descriptive, not evidence.
