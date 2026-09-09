# Strategies

Stored in `strategies` (id + version). Do not overwrite a historical version.

| Id | Idea | Notes |
| --- | --- | --- |
| `momentum_v1` | Acceleration + volume + min liquidity | Majors and liquid DEX |
| `discovery_liquidity_v1` | New pools with real liquidity | Heavy rug penalty |
| `news_reaction_v1` | NEW/RECENT article entity-linked to an asset | Ticker match ≠ causation |
| `social_proxy_v1` | Trending / mention proxy | Not an X firehose |
| `polymarket_macro_v1` | Probability jump + crypto beta | Coincidence only |
| `smart_money_follow_v1` | Repeated large prints | Wallets start as `unknown` |

Entry, exit, risk and confidence live in `params` JSON. Paper broker still applies global risk limits.
