import { randomUUID } from "node:crypto";
import { getSql, type Sql } from "@/lib/db";

const PROCESS_ID = randomUUID();
const PROCESS_STARTED_AT = new Date().toISOString();
const EXPERIMENT_ID = process.env.SEVEN_DAY_EXPERIMENT_ID?.trim() || "seven-day-local-2026-09";

export async function markHeartbeat(
  sql: Sql,
  job: string,
  status: "STARTING" | "RUNNING" | "OK" | "FAILED",
  success = false,
  details: Record<string, unknown> = {},
): Promise<void> {
  await sql.query(
    `insert into runtime_heartbeats (job, status, process_id, started_at, last_attempt_at, last_success_at, details, updated_at)
     values ($1,$2,$3,$4,now(),case when $5 then now() else null end,$6::jsonb,now())
     on conflict (job) do update set status=excluded.status, process_id=excluded.process_id,
       started_at=coalesce(runtime_heartbeats.started_at, excluded.started_at),
       last_attempt_at=excluded.last_attempt_at,
       last_success_at=coalesce(excluded.last_success_at, runtime_heartbeats.last_success_at),
       details=excluded.details, updated_at=now()`,
    [job, status, PROCESS_ID, PROCESS_STARTED_AT, success, JSON.stringify(details)],
  );
}

export async function ensureExperiment(sql: Sql): Promise<void> {
  const portfolio = (await sql.query<{ equity_usd: number }>(
    "select equity_usd from paper_portfolios where id='paper-default'",
  ))[0];
  const [positions, completed, resolved, strategy, learner] = await Promise.all([
    sql.query<{ n: number }>("select count(*)::int n from positions where portfolio_id='paper-default'"),
    sql.query<{ n: number }>("select count(*)::int n from paper_fills where portfolio_id='paper-default' and side='sell'"),
    sql.query<{ n: number }>("select count(*)::int n from trade_outcomes"),
    sql.query<{ version: string }>("select version from strategies where enabled=true order by created_at desc limit 1"),
    sql.query<{ learner_version: string }>("select learner_version from learner_versions order by created_at desc limit 1"),
  ]);
  await sql.query(
    `insert into experiments (id, starting_equity_usd, starting_open_positions, starting_completed_trades,
       starting_resolved_experiences, application_commit, strategy_version, learner_version, configuration_version)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'seven-day-v1') on conflict (id) do nothing`,
    [
      EXPERIMENT_ID,
      Number(portfolio?.equity_usd ?? 0),
      Number(positions[0]?.n ?? 0),
      Number(completed[0]?.n ?? 0),
      Number(resolved[0]?.n ?? 0),
      process.env.APP_COMMIT?.trim() || "unknown",
      strategy[0]?.version ?? null,
      learner[0]?.learner_version ?? null,
    ],
  );
}

export async function initializeRuntime(): Promise<void> {
  const sql = await getSql();
  await sql.query(
    "update ingest_runs set status='interrupted',finished_at=now(),errors='[\"process restart\"]'::jsonb where status='running'",
  );
  const previous = (await sql.query<{ last_success_at: string | null }>(
    "select last_success_at from runtime_heartbeats where job='ingestion'",
  ))[0];
  if (previous?.last_success_at) {
    const start = new Date(previous.last_success_at).getTime();
    const end = Date.now();
    const durationSeconds = Math.floor((end - start) / 1000);
    if (durationSeconds > 360) {
      await sql.query(
        `insert into data_gaps (id, experiment_id, source, gap_start, gap_end, duration_seconds, recovery, notes)
         values ($1,$2,'all_internet_sources',$3,$4,$5,'UNAVAILABLE','Restart gap recorded; no observations invented.')
         on conflict (source, gap_start, gap_end) do nothing`,
        [randomUUID(), null, previous.last_success_at, new Date(end).toISOString(), durationSeconds],
      );
      await sql.query("update experiments set interruption_count=interruption_count+1,last_recovered_at=now(),updated_at=now() where id=$1", [EXPERIMENT_ID]);
    }
  }
  await markHeartbeat(sql, "process", "OK", true, { experimentId: EXPERIMENT_ID });
}

export async function getRuntimeStatus(sql: Sql) {
  const [heartbeats, experiment, metrics] = await Promise.all([
    sql.query<Record<string, unknown>>("select job,status,started_at,last_attempt_at,last_success_at,updated_at from runtime_heartbeats order by job"),
    sql.query<Record<string, unknown>>("select * from experiments where id=$1", [EXPERIMENT_ID]),
    sql.query<Record<string, unknown>>(
      `select
        (select count(*)::int from assets) assets,
        (select count(*)::int from trade_decision_snapshots) decisions,
        (select count(*)::int from paper_fills where side='sell') completed_trades,
        (select count(*)::int from trade_outcomes) resolved_experiences,
        (select count(*)::int from positions where portfolio_id='paper-default') open_positions`,
    ),
  ]);
  const e = experiment[0];
  const m = metrics[0] ?? {};
  return {
    experiment: e ? {
      id: String(e.id),
      started_at: String(e.started_at),
      starting_equity_usd: Number(e.starting_equity_usd ?? 0),
      starting_open_positions: Number(e.starting_open_positions ?? 0),
      starting_completed_trades: Number(e.starting_completed_trades ?? 0),
      starting_resolved_experiences: Number(e.starting_resolved_experiences ?? 0),
      interruption_count: Number(e.interruption_count ?? 0),
    } : null,
    heartbeats: heartbeats.map((h) => ({
      job: String(h.job), status: String(h.status),
      started_at: h.started_at ? String(h.started_at) : null,
      last_attempt_at: h.last_attempt_at ? String(h.last_attempt_at) : null,
      last_success_at: h.last_success_at ? String(h.last_success_at) : null,
      updated_at: String(h.updated_at),
    })),
    metrics: {
      assets: Number(m.assets ?? 0),
      decisions: Number(m.decisions ?? 0),
      completed_trades: Number(m.completed_trades ?? 0),
      resolved_experiences: Number(m.resolved_experiences ?? 0),
      open_positions: Number(m.open_positions ?? 0),
    },
  };
}
