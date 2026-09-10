# X/Twitter market-moving intelligence

A low-latency, cost-controlled X ingestion path for **high-value, market-moving accounts only**.

This is **not** a general X scraper. It is designed to detect genuinely market-moving posts from a small, verified watchlist as cheaply and quickly as the legitimate X API allows.

## What it does

- Uses the existing `X_BEARER_TOKEN` credential — no second auth system.
- Connects to X's **filtered stream** API (`https://api.twitter.com/2/tweets/search/stream`) when enabled.
- Watches a compact, tiered account list defined in `config/x-market-watchlist.ts`.
- Filters out noise immediately (birthday wishes, generic greetings, etc.).
- Classifies every post into event categories (`TARIFF`, `FED`, `ETF`, `CRYPTO_REGULATION`, ...).
- Extracts affected assets, sectors and companies, including indirect references (e.g. "foreign chips" → NVDA / AMD / INTC / semiconductors).
- Scores market impact 0–100 using account influence, asset relevance, event severity, novelty and specificity.
- Checks market reaction against CoinGecko market snapshots.
- Generates latency-aware paper-only signals: `EARLY_PAPER_SIGNAL`, `LATE_EVENT`, `WAIT`, `REJECT`.
- Records every stage timestamp and exposes p50/p95/p99 latency on the **X intelligence** dashboard page.
- Deduplicates by post ID, author and content fingerprint.
- Cross-source confirmation uses existing `detected_events` and news tables.
- Feeds high-impact X events into `x_learning` for historical outcome tracking and account ranking.

## Enablement

X ingestion is **off by default**. Enable it in the environment or in `secrets/runtime.env`:

```bash
X_ENABLED=true
X_MODE=filtered_stream
X_BEARER_TOKEN=AAAAAAAAAAAAAAAAAAAAAA...
# optional tuning
X_MIN_IMPACT_SCORE=60          # min impact for "breaking" dashboard / learning row
X_STORAGE_MIN_IMPACT=10          # min impact to persist a lightweight x_stream_posts row
```

Then restart the dev server. The stream consumer starts automatically on the server side.

## Watchlist tiers

| Tier | Count | Examples | Influence weight |
|------|-------|----------|-----------------|
| Tier 1 | ~10 | Donald Trump, POTUS, Elon Musk, Janet Yellen, Federal Reserve, SEC, CZ, Brian Armstrong, Michael Saylor, Vitalik Buterin | 1.0 |
| Tier 2 | ~20 | NVIDIA, Apple, Microsoft, Amazon, Google, Meta, Tesla, AMD, Intel, major banks, exchanges, stablecoins | 0.7 |
| Tier 3 | ~15 | AP, Reuters, Bloomberg, CNBC, FT, WSJ, CoinDesk, Cointelegraph, financial journalists | 0.55 |

Edit `config/x-market-watchlist.ts` to change accounts. Each account has `username`, `displayName`, `category`, `tier`, `influenceScore`, `assetsOfInterest` and `enabled`.

## Cost control

The pipeline is staged:

```
X stream
  → account-on-watchlist?        (cheap string compare)
  → noise filter                 (regex)
  → entity / event classification (keyword rules)
  → basic impact score            (arithmetic)
  → IF impact ≥ X_MIN_IMPACT_SCORE
      → market snapshot + signal + learning row + detected_events
  → ELSE IF impact ≥ X_STORAGE_MIN_IMPACT
      → lightweight x_stream_posts row
  → ELSE
      → discard / minimal audit
```

The majority of posts never reach the expensive downstream path. There is no LLM call in the hot path.

## Dashboard

Visit the **X intelligence** page in the app sidebar to see:

- Stream connection state and last error
- Watchlist summary by tier
- p50/p95/p99 latency percentiles
- Breaking high-impact events
- Per-account performance stats
- Recent watchlist posts

## Important limitations

1. **Filtered stream requires a long-lived connection.** In local dev / preview this works because the process stays up. On serverless platforms (Vercel) the stream cannot stay open between invocations. In production the stream will report `STREAM DISCONNECTED` unless the app is deployed to a long-lived host.
2. **No latency guarantee.** The system measures actual observed latency, but X's own delivery latency and rate-limit behavior dominate. Do not expect or advertise sub-second/sub-minute guarantees.
3. **Market reaction is a point-in-time snapshot.** The current implementation uses the asset's already-observed 24h change as a crude abnormal-return proxy. A full post-event price re-check is a future improvement.
4. **Paper only.** Signals are advisory. No wallets, exchange keys, or order execution are added.
5. **No fake data.** If X auth fails or the stream is unavailable, the dashboard shows `X SOURCE UNAVAILABLE` and no posts are fabricated.

## Files

- `config/x-market-watchlist.ts` — tiered account list
- `src/lib/aether/x-market-pipeline.ts` — pure deterministic classification / scoring / entity extraction
- `src/lib/aether/x-market-intelligence.ts` — stream consumer, storage, dashboard query, learning integration
- `src/routes/x-intelligence.tsx` — dashboard UI
- `migrations/0008_x_market_intelligence.sql` — schema additions
- `migrations/0009_x_learning.sql` — learning/feedback table
- `src/lib/aether/x-market-pipeline.test.ts` and `src/lib/aether/x-market-intelligence.test.ts` — deterministic tests
