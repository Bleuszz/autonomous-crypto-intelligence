/**
 * X API spend control.
 *
 * Recent search is paid. The desk is budgeted for a ~$5 week: one compact
 * query, 10 tweets, a few hours between calls, hard daily/weekly caps.
 * A 429/402/401 trips a multi-hour backoff.
 */

export const X_DAILY_CAP = 8;
export const X_WEEKLY_CAP = 48;
export const X_MIN_INTERVAL_MS = 3 * 60 * 60 * 1000;
export const X_BACKOFF_MS = 6 * 60 * 60 * 1000;
export const X_MAX_RESULTS = 10;
export const X_SEARCH_QUERY =
  "(bitcoin OR ethereum OR solana) (ETF OR breakout OR listing OR whale) lang:en -is:retweet -is:reply";

export type XBudgetState = {
  weekStart: string;
  callsWeek: number;
  day: string;
  callsToday: number;
  lastCallAt: number | null;
  lastSuccessAt: number | null;
  backoffUntil: number | null;
  lastStatus: number | null;
  lastError: string | null;
  tweetsPulled: number;
};

export function emptyXBudget(now = Date.now()): XBudgetState {
  return {
    weekStart: isoDay(weekStartMs(now)),
    callsWeek: 0,
    day: isoDay(now),
    callsToday: 0,
    lastCallAt: null,
    lastSuccessAt: null,
    backoffUntil: null,
    lastStatus: null,
    lastError: null,
    tweetsPulled: 0,
  };
}

export function decodeSecret(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  if (!t) return undefined;
  if (!t.includes("%")) return t;
  try {
    return decodeURIComponent(t);
  } catch {
    return t;
  }
}

export function weekStartMs(now: number): number {
  const d = new Date(now);
  const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const day = new Date(utc).getUTCDay(); // 0 Sun
  const mondayOffset = day === 0 ? 6 : day - 1;
  return utc - mondayOffset * 86_400_000;
}

export function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function rollBudget(state: XBudgetState, now = Date.now()): XBudgetState {
  const week = isoDay(weekStartMs(now));
  const day = isoDay(now);
  return {
    ...state,
    weekStart: week,
    day,
    callsWeek: state.weekStart === week ? state.callsWeek : 0,
    callsToday: state.day === day ? state.callsToday : 0,
    tweetsPulled: state.weekStart === week ? state.tweetsPulled : 0,
  };
}

export type XCallDecision =
  | { ok: true }
  | { ok: false; reason: string };

export function shouldCallX(
  state: XBudgetState,
  now = Date.now(),
  caps: { daily: number; weekly: number; minIntervalMs: number } = {
    daily: X_DAILY_CAP,
    weekly: X_WEEKLY_CAP,
    minIntervalMs: X_MIN_INTERVAL_MS,
  },
): XCallDecision {
  const s = rollBudget(state, now);
  if (s.backoffUntil && now < s.backoffUntil) {
    return { ok: false, reason: `backoff until ${new Date(s.backoffUntil).toISOString()}` };
  }
  if (s.callsToday >= caps.daily) return { ok: false, reason: `daily cap ${caps.daily}` };
  if (s.callsWeek >= caps.weekly) return { ok: false, reason: `weekly cap ${caps.weekly}` };
  if (s.lastCallAt && now - s.lastCallAt < caps.minIntervalMs) {
    return { ok: false, reason: "min interval" };
  }
  return { ok: true };
}

export function applyXCall(
  state: XBudgetState,
  result: { ok: boolean; status: number; error: string | null; tweets: number },
  now = Date.now(),
): XBudgetState {
  const s = rollBudget(state, now);
  const paid = result.status !== 0;
  const next: XBudgetState = {
    ...s,
    lastCallAt: now,
    lastStatus: result.status,
    lastError: result.ok ? null : result.error,
    callsToday: s.callsToday + (paid ? 1 : 0),
    callsWeek: s.callsWeek + (paid ? 1 : 0),
    tweetsPulled: s.tweetsPulled + Math.max(0, result.tweets),
    lastSuccessAt: result.ok ? now : s.lastSuccessAt,
  };
  if (!result.ok && (result.status === 429 || result.status === 402 || result.status === 401 || result.status === 403)) {
    next.backoffUntil = now + X_BACKOFF_MS;
  }
  return next;
}

export function nextXCallAt(state: XBudgetState, now = Date.now()): number | null {
  const s = rollBudget(state, now);
  const decision = shouldCallX(s, now);
  if (decision.ok) return now;
  const times: number[] = [];
  if (s.backoffUntil) times.push(s.backoffUntil);
  if (s.lastCallAt) times.push(s.lastCallAt + X_MIN_INTERVAL_MS);
  if (s.callsToday >= X_DAILY_CAP) {
    const [y, m, d] = s.day.split("-").map(Number);
    times.push(Date.UTC(y, m - 1, d + 1));
  }
  if (s.callsWeek >= X_WEEKLY_CAP) {
    times.push(weekStartMs(now) + 7 * 86_400_000);
  }
  return times.length ? Math.max(...times) : now + X_MIN_INTERVAL_MS;
}
