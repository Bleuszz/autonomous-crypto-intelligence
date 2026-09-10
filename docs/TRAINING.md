# Training

Aether is a paper-training / strategy-discovery laboratory.

```
OBSERVE → COLLECT → VALIDATE DATA → DE-DUPLICATE → CHECK TIMESTAMP
  → REGIME → ANALYSE → DECIDE → PAPER EXECUTE → MEASURE
  → COUNTERFACTUALS → REWARD → ATTRIBUTE → PATTERNS → LEARN
  → VALIDATE → WALK-FORWARD → CAPITAL SCALES → IMPROVE
```

The objective is **more high-quality, diverse, timestamp-correct experiences** — not more trades. The £100,000 paper book is a research laboratory, not a forecast of the operator's capital.

## Dual capital

| Profile | Book | Purpose |
|---|---|---|
| Research | £100,000 | Throughput. More concurrent legitimate opportunities. |
| Realistic | £100 | Deployment gate. Fees, min size, liquidity, cash lock. |

The system must never learn that £100,000 will normally be available.

Every meaningful learner version is compared across **£100, £250, £500, £1,000, £5,000, £10,000, £100,000**.

If a behaviour only works at £100k: **CAPITAL-SCALE DEPENDENT — NOT DEPLOYMENT READY**.

Position size is not a fixed percent of the research book. It is clipped by confidence, historical reliability, volatility, liquidity take and 24h volume take. A ticket that cannot clear the minimum order at 1–3% of £100 is **REJECT** — the sizer will not secretly inflate the ticket to invent a fill.

## Historical replay

Replay is the training loop. Public Kraken daily OHLC (BTC, ETH) is replayed as if live:

1. Decision time is **bar close**, so the close is information that existed then.
2. Only news/social/events with timestamps ≤ decision time are visible.
3. The engine emits ENTER / WAIT / REJECT. WAIT is a real decision, never missing data.
4. Time advances. Outcomes and WAIT/REJECT counterfactuals use **only later prices**.
5. Look-ahead-dirty rows are dropped from training (`lookahead_clean=false` → weight 0).
6. Alternative entries (immediate, +1m, +5m, +15m, +30m, next candle) measure remaining edge. On daily bars the intra-bar offsets honestly report **DATA UNAVAILABLE**.

A strategy that only fills with `delayMs = 0` is invalid under delayed-data discipline.

## Anti-lookahead

Every replay decision records:

- `decision_timestamp`
- `latest_market_data_timestamp`
- `latest_news_timestamp`
- `latest_social_timestamp`
- `latest_event_timestamp`
- `analysis_timestamp`

Future candles, news, social, events or revised prints are stripped. Automated tests inject future data and expect a violation. Reward is computed from **later** prices, never from the contemporaneous mark.

## WAIT and REJECT

WAIT is a decision. The subsequent path is stored as a hypothetical (opportunity cost vs avoided loss).

REJECT stores a counterfactual fill so risk filters can be scored for the trades they prevented — including the ones they should not have blocked.

## Hard negatives

Failed breakouts, social hype with no follow-through, already-priced news, wash volume and setups that should have been WAIT/REJECT are retained. The learner is not trained primarily on winners. Ten highly correlated BTC/ETH trades count as fewer independent experiences (`correlation_adjusted_experience_count`).

Trades are never created solely to pad the dataset. If there are three legitimate opportunities, three is correct.

## Splits

`RAW → TRAINING → VALIDATION → OOS → WALK-FORWARD → PAPER CANARY`

Training on OOS rows is contamination and is rejected. Champion replacement requires a majority of **primary** metrics (Sharpe, expectancy, drawdown, Calmar, payoff, OOS, calibration) — not in-sample profit or win rate. Capital-dependent challengers cannot replace the champion.

## Survivorship

Assets that go illiquid, delist, fail or rugged stay in `asset_lifecycle` (`ACTIVE | ILLIQUID | DELISTED | FAILED | RUGGED | UNKNOWN`). Historical observations are never silently deleted. A set that contains only ACTIVE assets is flagged as survivorship-bias risk.

## Information decay

For market-moving events the desk records published / detected / analysed / reaction-start / peak. An event detected immediately may still have edge; the same event minutes later may have none.

## Source trust

- Events outrank tweets.
- X/Twitter is noisy and low-trust (weight 0.25 vs events 1.0).
- Wallets count when they have a verified track record.
- News only if timestamped and entity-linked.
- Polymarket is information, not a trading venue unless explicitly paper-traded.
- Duplicate reports of the same story map to one `event_cluster_id`. Independent sources may confirm; they must not multiply evidence.

## Honesty

When the dataset is thin the UI says **INSUFFICIENT EVIDENCE** or **DATA UNAVAILABLE**. No fabricated history, P&L, accuracy or “this strategy prints money”. Missing prices are rejected, never invented.

Live execution stays compiled out (`canSubmit: false`).
