# Strategies

Stored in `strategies` (id + version). Do not overwrite a historical version.

| Id | Idea | Notes |
| --- | --- | --- |
| `momentum_v1` / `momentum_v2` | Acceleration + volume + min liquidity | Majors and liquid DEX |
| `major_dip_v2` | Listed majors down on the day, 1h turning up | Default paper entry in mixed/fear tapes |
| `mean_revert_v2` | Oversold major, lifting spark | Not a bottom call |
| `breakout_v2` | Holding 7d spark highs | Volume confirmation |
| `rel_strength_v2` | Beating BTC without a vertical candle | Alts only |
| `funding_squeeze_v2` | Very negative BTC perp funding | Paper hypothesis |
| `discovery_liquidity_v1` | New pools with real liquidity | Heavy rug penalty |
| `news_reaction_v1` | NEW/RECENT article entity-linked | Ticker match ≠ causation; bearish tone can sell |
| `social_proxy_v1` | Trending / mention proxy | **Not auto-traded** |
| `polymarket_macro_v1` | Probability jump + crypto beta | Coincidence only |
| `smart_money_follow_v1` | Repeated large prints | Wallets start as `unknown` |
| `momentum_fade_v2` | 1h reversal after an extended 24h | Sell / exit |
| `exit_*_v2` | Stop, take, trail, time, regime, macro | Inventory management |

Entry, exit, risk and confidence live in `params` JSON. Paper broker still applies global risk limits.
