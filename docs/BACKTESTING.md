# Backtesting

Engine: `src/lib/aether/backtest.ts`.

- Signal at bar `i` uses `close[i]` vs `close[i-lookback]` only
- Buy fills at **next bar open**
- Sell fills at this bar close
- Fees + slippage on both sides
- Walk-forward: 70% in-sample, 30% out-of-sample; the dashboard reports **OOS** metrics
- Full-sample equity is shown for inspection and must not be used for selection
- A buy-and-hold benchmark is computed and compared against the strategy
- Random-entry baseline available for sanity-checking cost assumptions
- Rolling walk-forward windows available via `rollingWalkForward`

Metrics: total return, annualized (when the window is long enough), Sharpe, Sortino, Calmar, max drawdown, win rate, profit factor, average/median trade, exposure, fees, slippage, best/worst, consecutive losses, average win/loss, payoff ratio, expectancy, benchmark outperformance.

Too few trades → treat Sharpe as descriptive, not evidence.
