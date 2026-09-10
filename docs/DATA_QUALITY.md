# Data quality

Paper entries and learning weights are gated by a 0–100 data-quality score. **One source is never treated as ground truth.**

## What is scored

- Source reliability (per `SOURCE_RELIABILITY`)
- Freshness and delayed-data penalty (marks older than ~3 minutes are delayed; older than 12 minutes are stale and **block** new entries)
- Timestamp accuracy across quotes
- Completeness of price / volume / liquidity / source
- Cross-source agreement (spread vs a 50 bps major / 200 bps DEX threshold)
- Fake-move / wash heuristics (vertical print on a thin book, volume without confirmation)
- Event-to-price and news-to-market confirmation

## Missing data

If there is no positive primary price and no independent quotes, the score is 0, learning weight is 0, and paper **REJECT** is recorded with `DATA UNAVAILABLE: missing price — not invented`. Gaps are never filled with the last known print, a peer asset, or a made-up mid.

## Conflicts

Disagreement is recorded, not averaged away:

- `source_conflict=true`
- `conflicting_sources`
- `conflict_type` / `conflict_severity`

The learner is supposed to treat conflict as lower confidence.

## Learning weight

Low-quality rows are not deleted. They receive a lower `learningWeight` (and below 25 they contribute nothing). Bad data is never equivalent to a clean tape. Look-ahead-dirty rows also get weight 0.

## Entry floor

`DATA_QUALITY_MIN_ENTRY = 55`. Below that, or if the mark is stale, or if a high-severity price conflict / suspected fake pump is present, paper **REJECT** is recorded. That is a real decision, not a missing fill.

## Source trust

X/Twitter is noisy (reliability 0.55, evidence weight 0.25). Events outrank tweets. Wallets count when verified. Untimestamped news contributes nothing. Polymarket is an information source, not a venue.
