# Setup

## Hosted

The desk runs in the Aether preview/deploy. Database and `XAI_API_KEY` are injected. No local Docker is required.

## Self-host (optional)

```bash
npm install
cp .env.example .env   # fill nothing for paper + public data
npm run dev
```

Postgres is optional. Without `DATABASE_URL` the app uses embedded PGLite (data resets on process restart).

```bash
# optional
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

See [API_KEYS.md](API_KEYS.md). Public market, news, Polymarket and DEX APIs work without keys.
