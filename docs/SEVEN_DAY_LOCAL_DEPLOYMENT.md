# Seven-day local paper-research deployment

## Architecture

The authoritative engine runs locally: Cloudflare Quick Tunnel → `app` (TanStack Start/Nitro) → persistent PostgreSQL. Cloudflare is only an outbound proxy. PostgreSQL is isolated on Docker's internal `backend` network and has no published host or Internet port. The app is also available locally at `http://127.0.0.1:18080`.

The `app`, dedicated `engine`, `postgres`, and `cloudflared` services use `restart: unless-stopped`. PostgreSQL data lives in the named volume `autonomous_crypto_postgres_data`. Docker JSON logs rotate at five 10 MB files per service. Runtime files, credentials, logs, public URL, and backups are ignored by Git.

The deployment hard-codes `TRADING_MODE=PAPER`, `ENABLE_LIVE_TRADING=false`, and an empty live unlock. The existing live adapter remains fail-closed. Dashboard Basic Auth is enforced by server middleware; only minimal `/healthz` and `/engine-healthz` probes are unauthenticated.

## Operations

- Start or repair: `powershell -ExecutionPolicy Bypass -File .\start-seven-day-run.ps1`
- Rebuild and start: add `-Build`.
- Status: `powershell -ExecutionPolicy Bypass -File .\status-seven-day-run.ps1`
- Safe stop: `powershell -ExecutionPolicy Bypass -File .\stop-seven-day-run.ps1`
- Restore normal AC power timeouts after the experiment: `powershell -ExecutionPolicy Bypass -File .\restore-power-settings.ps1`

The start script waits for Docker, PostgreSQL, the application and authenticated dashboard, discovers the current Quick Tunnel URL, writes it to `runtime/CURRENT_PUBLIC_URL.txt`, and creates a baseline backup when one does not exist. It is idempotent and does not recreate the experiment or tunnel unnecessarily.

## Recovery and backups

`install-seven-day-recovery.ps1` installs these per-user Windows tasks:

- `AutonomousCryptoIntelligenceRecovery` at logon;
- `AutonomousCryptoIntelligenceWatchdog` every five minutes;
- `AutonomousCryptoIntelligenceDailyBackup` daily at 03:30.

The watchdog repairs stopped services, checks the durable engine heartbeat, and records outcomes in `runtime/recovery.log`. Daily SQL backups are retained in `backups/daily`; the newest ten are kept. The baseline is in `backups/seven-day-baseline`. Backups contain the complete database, including paper accounting, decisions, observations, events, outcomes, learning tables and experiment state.

Do not use `docker compose down -v`, volume prune, or delete `autonomous_crypto_postgres_data`. Normal container recreation, Docker restart, or Windows reboot preserves the database.

## Experiment state and metrics

Migration `0011_seven_day_runtime.sql` stores the experiment baseline, interruption history, data gaps, and heartbeats for process start, ingestion, scoring, decisions, paper ticks, outcome resolution, and learning. The `/system` page displays the experiment and heartbeat state. Existing source-health, decision snapshots, evidence packets, feature attribution, paper fills/snapshots, outcomes, rewards, experiences and learner-version tables provide the seven-day data, trading, learning and source-contribution measurements relative to the persisted baseline.

When a restart gap exceeds six minutes it is recorded as unavailable source data; no synthetic observation is created. Orders, fills, positions, and cash updates execute transactionally. Existing open positions and equity are always loaded from PostgreSQL; the starting-equity setting only seeds a genuinely new database.

## Cloudflare limitation

Quick Tunnels are a free development/testing facility with no uptime SLA. Their random `trycloudflare.com` hostname can change whenever the tunnel container is recreated. The startup/status tooling detects and records the current hostname. Cloudflare Tunnel requires outbound connectivity to Cloudflare on port 7844; no inbound firewall rule or router port-forward is required.
