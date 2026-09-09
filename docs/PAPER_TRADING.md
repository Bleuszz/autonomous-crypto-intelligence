# Paper trading

Paper is the only execution venue.

Starting equity: **$10,000** on `paper-default`.

A fill is never assumed at the signal mid. The model applies:

- latency (1.5–9s, seeded)
- mid drift from recent volatility over that latency
- size vs pool liquidity impact
- DEX fee (30 bps default)
- chain gas (ETH / L2 / SOL)

Rejected orders stay on the blotter with a reason (kill switch, concentration, thin book, slippage cap, daily loss).

Exits: −8% stop, +18% take, or 36h time stop — all still go through the fill model.

Copying a wallet print uses the same model plus extra delay. The observed transaction price is not treated as executable.
