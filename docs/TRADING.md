# Trading

Default: `TRADING_MODE=PAPER`.

## LIVE activation procedure (do not run this yet)

Live mode is **compiled out**. Even if you complete the list below, this build will refuse to submit.

To even *consider* a future live build, ALL of the following must be true:

1. `ENABLE_LIVE_TRADING=true`
2. `TRADING_MODE=LIVE`
3. System config `enable_live_trading` explicitly true (typed confirmation in a later UI)
4. `LIVE_EXECUTION_UNLOCK=I_UNDERSTAND_THIS_SPENDS_REAL_MONEY`
5. Separate live exchange credentials (withdrawals disabled)
6. Risk limits present (size, daily loss, concentration, chain, slippage)
7. Kill switch **off**
8. Per-strategy and per-asset pause lists reviewed
9. Startup safety check passing
10. You are not in an ephemeral preview environment

**Do not activate live mode.** Paper-trade until out-of-sample and prospective results exist.

## Kill switch

System page or `KILL_SWITCH=true`. Blocks new orders. Does not unwind positions automatically.
