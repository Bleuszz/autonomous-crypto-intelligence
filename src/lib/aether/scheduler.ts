import { INGEST_POLL_MS } from "./config";

const g = globalThis as typeof globalThis & {
  __aetherDeskTimer?: ReturnType<typeof setInterval>;
  __aetherDeskKick?: ReturnType<typeof setTimeout>;
};

/**
 * Long-running desk only (dev / preview process). Serverless invocations
 * still ingest on request via ensureIngested. Does not call X on its own —
 * ingestOnce owns the X budget gate.
 */
export function startDeskScheduler(tick: () => void): void {
  if (typeof window !== "undefined") return;
  if (g.__aetherDeskTimer) return;
  g.__aetherDeskKick = setTimeout(tick, 4_000);
  g.__aetherDeskTimer = setInterval(tick, INGEST_POLL_MS);
}
