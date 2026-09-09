# Setup

## Hosted

The desk runs in the Aether preview. Database and `XAI_API_KEY` are injected. Public market feeds do not need extra keys. X recent-search uses gitignored `secrets/runtime.env` on this instance.

## Clone the private repo

```bash
git clone git@github.com:Bleuszz/autonomous-crypto-intelligence.git
cd autonomous-crypto-intelligence
npm install
```

HTTPS alternative if SSH keys are not set up:

```bash
git clone https://github.com/Bleuszz/autonomous-crypto-intelligence.git
cd autonomous-crypto-intelligence
npm install
```

The repository is **private**. You must be logged into GitHub as the owner (or a collaborator).

## X credentials (optional, paid)

Public CoinGecko / DexScreener / news / Polymarket ingest works without this. Official X recent-search needs a bearer.

```bash
mkdir -p secrets
cp .env.example secrets/runtime.env
```

Edit `secrets/runtime.env` and set at least:

```bash
TRADING_MODE=PAPER
ENABLE_LIVE_TRADING=false
X_API_KEY=<consumer key>
X_API_SECRET=<consumer secret>
X_BEARER_TOKEN=<paste exactly as the X portal shows it>
DIGEST_TO=<private; never commit>
```

Do **not** URI-decode the bearer. Do **not** commit `secrets/`. The spend ledger is `secrets/x-budget.json` (also gitignored). Caps: 8 calls/day, 48/week, 3 hours between calls.

## Run

```bash
npm run dev
```

Open the URL the script prints (this workspace serves the live preview automatically).

Postgres is optional. Without `DATABASE_URL` the app uses embedded PGLite (data resets on process restart).

```bash
# optional durable Postgres
docker compose -f infra/docker-compose.yml up -d
export DATABASE_URL=postgres://aether:aether@localhost:5432/aether
npm run db:migrate
```

## Tests

```bash
npm test
npm run typecheck
```

## What you need now vs later

See [API_KEYS.md](API_KEYS.md). Public market, news, Polymarket and DEX APIs work without keys. Live execution stays compiled out — see [TRADING.md](TRADING.md).
