# Paper trading

Paper is the only execution venue.

Starting equity: **$10,000** on `paper-default`.

A fill is never assumed at the observed mid. The model applies:

- latency (1.5–9s, seeded)
- mid drift from recent volatility over that latency
- size vs pool liquidity impact
- DEX fee (30 bps default)
- chain gas (ETH / L2 / SOL)

For a buy, `notionalUsd` is the **gross position size** you want to acquire. The cash required = gross notional + fee + gas, and quantity = gross notional / fill price. This keeps reported size consistent with what the blotter shows.

The engine **buys and sells on live marks** every ingest:

**Entries** (max 4 new / cycle, max 6 open, ≥22% cash kept):

- `major_dip_v2` — listed majors down on the day with a 1h turn
- `momentum_v2` — 1h + 24h acceleration with volume, 24h capped so memes are not chased
- `mean_revert_v2` — oversold majors whose short-horizon spark is lifting
- `breakout_v2` — holding 7d highs
- `rel_strength_v2` — beating BTC without a vertical candle
- `funding_squeeze_v2` — very negative BTC perp funding
- High-quality strategy signals (social-proxy is ignored)

Live CEX last-prints (Kraken, Coinbase, OKX, Binance when reachable, CoinCap) overlay CoinGecko and stamp a fresh `observedAt`. DXY bids shrink alt size and can exit non-BTC/ETH inventory. High BTC mempool fees refuse new DEX entries.

**Exits:**

- Hard stop (~4.5% majors / ~7% DEX)
- Take profit (~7% / ~12%)
- Trailing stop off peak once armed
- Time cut (10h if not working, 40h max)
- 1h reversal, BTC risk-off for alts, extreme-greed trim
- DXY bid (`exit_macro_v2`) for alts that are not working

Rejected orders stay on the blotter with a reason (concentration, thin book, slippage cap, daily loss, insufficient cash after fill costs).

**P&L accounting**

Round-trip realized P&L is computed by matching sell fills against prior buy fills per asset (FIFO). The dashboard reports wins/losses from completed round trips, not from currently open positions. Unrealized P&L uses the latest mark.

Copying a wallet print uses the same model plus extra delay. The observed transaction price is not treated as executable.
