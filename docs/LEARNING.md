# Reward + Adaptive Learning Engine

This document describes the self-improving layer added to the Aether paper-trading desk.

## Purpose

The learning engine studies every paper decision the system makes, measures what happened afterwards, calculates a normalized reward, attributes the result to the available evidence, discovers conditional patterns, and extracts human-readable lessons. It is strictly shadow-mode at the start: it records what it *would* recommend but does not alter paper execution until it passes validation.

## Safety rules

- **Paper only.** The learner may change strategy weights, thresholds, scoring recommendations, and position-sizing suggestions. It may never trigger live order execution, withdrawals, or real-money actions.
- **Hard risk gates cannot be overridden.** Max drawdown, daily loss, stale-data, liquidity-take, slippage, concentration, and exposure limits are enforced before the learner is consulted.
- **No look-ahead.** Historical decisions are trained only on information available at decision time. Future prices, news, events, social posts, wallet activity, or feature values are never leaked into a decision snapshot.
- **No opaque AI.** The learner is a small, deterministic, interpretable weighted-evidence model based on discovered patterns, not a large neural network or uncontrolled online learner.

## Architecture

```
DATA
↓
FEATURES / REGIME / EVENTS / WALLETS
↓
PAPER DECISION (entry / exit / wait / reject)
↓
TRADE DECISION SNAPSHOT (immutable)
↓
TRADE EXECUTION
↓
TRADE OUTCOME SNAPSHOT (immutable)
↓
REWARD ENGINE
↓
FEATURE ATTRIBUTION
↓
EXPERIENCE MEMORY
↓
PATTERN DISCOVERY (binned conditions + sample-size gating)
↓
CONTEXTUAL LEARNER (weighted pattern evidence)
↓
SHADOW RECOMMENDATIONS
↓
VALIDATION (OOS, walk-forward, stability, cost sensitivity)
↓
CHAMPION / CHALLENGER PROMOTION
↓
APPROVED PAPER STRATEGY
```

## Decision snapshot

Every paper decision stores:

- asset, timestamp, strategy version, learner version
- deterministic feature values (momentum, liquidity, volume, market quality, smart money, social, news, risk, execution penalty)
- market structure (HTF trend, price vs 7d high, volatility regime)
- regime state
- evidence state (news/social/wallet/event boosts, signal agreement, contradictory signals)
- risk state (position size, concentration, liquidity take, slippage, daily loss used, hard limits hit)
- sizing and execution assumptions
- data quality (freshness, source reliability, staleness flags)
- learner recommendation (shadow, stored at decision time)

The snapshot is immutable. Outcome processing never rewrites it.

## Outcome snapshot

Recorded when a round-trip closes:

- entry and exit prices, quantity, realized P&L and return
- fees, gas, slippage
- holding time, MFE, MAE, drawdown impact
- exit reason and whether stop/target/thesis-invalidation occurred
- post-exit price movement for counterfactual research

## Reward engine

The reward is not raw P&L. It is a normalized composite:

```
totalReward =
  0.35 * outcomeQuality
+ 0.25 * decisionQuality
+ 0.15 * executionQuality
+ 0.15 * riskDiscipline
+ drawdownPenalty
+ slippagePenalty
+ feePenalty
+ contradictionPenalty
```

All components are bounded and deterministic.

- **Outcome quality:** realized R-multiple, favourable vs adverse excursion, holding-time efficiency, post-exit continuation.
- **Decision quality:** whether the available evidence (momentum, volume, liquidity, HTF trend, signal agreement) supported the thesis and whether the thesis direction was correct.
- **Execution quality:** slippage vs assumption, fee/gas drag, latency-driven churn.
- **Risk discipline:** position size within limits, liquidity take, stop discipline, drawdown impact.
- **Penalties:** drawdown, excessive slippage, excessive fees, entering against bearish HTF trend or contradictory signals.

Every reward also gets a classification:

- good decision / good outcome
- good decision / bad outcome (variance)
- bad decision / good outcome (luck)
- bad decision / bad outcome

and an avoidable-loss label when the evidence at entry was weak or contradictory.

## Feature attribution

After each completed trade the engine scores major features:

- Momentum, HTF trend, volume confirmation, resistance proximity, liquidity, social sentiment, news/events, wallet signal, regime, risk discipline, execution.

Contributions are labelled `STRONGLY_POSITIVE`, `POSITIVE`, `NEUTRAL`, `NEGATIVE`, or `STRONGLY_NEGATIVE`. Attribution uses careful language such as "associated with" or "historically predictive"; it does not claim causality.

## Pattern discovery

Patterns are discovered by binning the decision context:

- momentum band (low / medium / high)
- liquidity band
- volume band
- HTF trend (bullish / bearish / neutral)
- price vs 7d high (near high / mid / near low)
- volatility regime
- asset scope (major / DEX / other)
- regime label

For each bin the engine counts samples, positives, negatives, win rate, expectancy, average reward, reward variance, and a 90% confidence interval.

Sample-size gating is mandatory:

- fewer than 8 samples → not promoted
- fewer than 3 positive samples → not promoted
- lower confidence bound ≤ 0 → not promoted
- OOS expectancy ≤ 0 → not promoted

Patterns can be discovered globally, regime-separated, or asset-scope-separated so that a BTC-specific pattern is not naively applied to every altcoin.

## Contextual learner

The learner is a small Bayesian-style weighted-evidence model. For a given decision context it finds historically similar patterns and estimates:

- `ENTER` expected reward
- `WAIT` expected reward
- `REJECT` expected reward

The estimate is a weighted average of matching patterns, where weights combine:

- similarity to current context
- recency (configurable decay)
- sample-size credit (square-root of sample count)
- OOS expectancy when available

Confidence is bounded by the number and similarity of matching patterns. The learner is fully deterministic and reproducible.

## Learner operating states

The learner has three explicit operating states persisted server-side:

- `DISABLED` — the learner is not consulted and no predictions are recorded. The baseline deterministic trading system continues normally.
- `SHADOW` (default) — the learner observes every decision, generates predictions, records them, and evaluates them later, but it does **not** influence execution.
- `ACTIVE` — the learner may influence the paper-trading decision layer. In the current implementation an `ACTIVE` learner that recommends `REJECT` or `WAIT` overrides the baseline `ENTER` for that cycle. It never bypasses hard risk gates and it never triggers live execution.

## Password-protected manual controls

The `/learning` dashboard exposes controls to switch between `DISABLED`, `SHADOW`, and `ACTIVE`. Every state change requires a server-side password check.

- The password is read from the server-side environment variable `LEARNING_CONTROL_PASSWORD`.
- If the variable is not set, the local-only default documented for this private application is `1234`.
- The password is never rendered in the UI, never logged, never stored in the database, and never sent to the browser as configuration.
- Every change attempt is recorded in `learner_control_audit` with previous/new state, success/failure, action, and reason. The password itself is never written anywhere.

Set a production password by creating `secrets/learning.env` (gitignored) or by exporting `LEARNING_CONTROL_PASSWORD` in the runtime environment.

## Prediction tracking and evaluation

Each snapshot that includes a learner recommendation becomes a prediction record. A prediction stores:

- baseline action (the deterministic strategy's action)
- predicted learner action (`ENTER` / `WAIT` / `REJECT`)
- confidence and expected reward at decision time
- actual reward after the round-trip resolves
- correctness: `ENTER`/`WAIT` are treated as positive predictions; `REJECT` is treated as a negative prediction

Predictions are evaluated only after the trade outcome is available, so the learner cannot train on future information.

## Shadow mode and promotion pipeline

The learner version starts in `SHADOW` mode. It records predictions next to every decision but does not change behaviour.

A learned change must pass:

```
DISCOVERED → SHADOW → TRAINED → VALIDATED → OUT-OF-SAMPLE → WALK-FORWARD → STABILITY CHECK → PAPER CANARY → APPROVED
```

At each gate the system checks sample counts, OOS performance, walk-forward stability, parameter-sensitivity robustness, and cost-sensitivity robustness. Failed challengers are `REJECTED`. Approved champions are monitored; if post-approval expectancy turns negative or drawdown exceeds a configured limit, the system rolls back to the previous champion.

## Dashboard

The `/learning` route shows:

- current learner operating mode (`DISABLED` / `SHADOW` / `ACTIVE`) and password-protected controls
- total, resolved, and unresolved prediction counts
- prediction accuracy and average reward
- action-specific accuracy (`ENTER`, `WAIT`, `REJECT`)
- confidence calibration buckets
- recent predictions with baseline action, agreement, actual reward, and correctness
- accuracy, average reward, cumulative reward, and volume charts over time
- learner vs baseline comparison
- performance by regime and by asset
- pattern intelligence with sample size, expectancy, OOS expectancy, walk-forward stability, and status
- extracted lessons with confidence labels
- champion / challenger status
- learning health diagnostics
- auditable control change log

## Research report

The dashboard and tables answer:

1. What did the system learn?
2. Which conditions predict good outcomes?
3. Which conditions predict bad outcomes?
4. Which signals became more or less reliable?
5. What mistakes were identified?
6. Which losses were avoidable?
7. Did the learner improve the baseline?
8. Did it improve out-of-sample?
9. Did it improve across walk-forward periods?
10. Did it overfit?
11. Which lessons remain uncertain?

Negative results and insufficient evidence are displayed explicitly.

## Limitations

- The learner is only as good as the frequency and diversity of paper round-trips. Early deployments will have few experiences and wide confidence intervals.
- Patterns are conditional associations, not causal proofs.
- Free data sources have rate limits, delays, and gaps that affect feature quality and learning speed.
- The system does not claim profitability; it measures paper-only outcomes under modelled costs.
- Walk-forward and OOS validation require a long enough history of decisions.

## Files

- `src/lib/aether/learning/types.ts` — shared types
- `src/lib/aether/learning/snapshots.ts` — immutable decision snapshots
- `src/lib/aether/learning/reward.ts` — reward engine
- `src/lib/aether/learning/attribution.ts` — feature attribution and lessons
- `src/lib/aether/learning/patterns.ts` — pattern discovery with sample-size gating
- `src/lib/aether/learning/learner.ts` — contextual learner (shadow mode)
- `src/lib/aether/learning/promotion.ts` — champion/challenger validation and rollback
- `src/lib/aether/learning/index.ts` — orchestration and database integration
- `migrations/0005_learning_engine.sql` — schema
- `src/routes/learning.tsx` — dashboard
- `docs/LEARNING.md` — this document
