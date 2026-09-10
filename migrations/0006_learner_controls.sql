-- Learner controls, audit trail, and prediction-evaluation support.
-- Auth is off; this is a local/private application. The control password is
-- read from the server-side environment (LEARNING_CONTROL_PASSWORD); the UI
-- never sees it, the audit log never stores it, and it is not committed.

-- Track the deterministic baseline action separately from the action actually
-- taken (important when the learner is ACTIVE and overrides the baseline).
alter table trade_decision_snapshots
  add column if not exists baseline_action text;

-- Server-side learner operating mode. Default remains SHADOW.
insert into system_config (key, value, updated_at)
  values ('learner_operating_state', '{"mode":"SHADOW"}', now())
  on conflict (key) do nothing;

-- Auditable log of every learner state change attempt.
create table if not exists learner_control_audit (
  id text primary key,
  changed_at timestamptz not null default now(),
  previous_state text not null,
  new_state text not null,
  action text not null,
  success boolean not null,
  reason text,
  client_context jsonb not null default '{}'
);
create index if not exists learner_control_audit_changed_idx on learner_control_audit (changed_at desc);
