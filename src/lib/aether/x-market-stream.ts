/**
 * X/Twitter filtered stream primitives.
 *
 * No database imports here, so this module can be unit-tested with Node's
 * built-in test runner without pulling in PGLite/Neon bootstrap.
 */

import { envStr } from "./config.ts";
import { enabledWatchlist, type XMarketAccount } from "../../../config/x-market-watchlist.ts";
import { type XPost } from "./x-market-pipeline.ts";

export function xMarketEnabled(): boolean {
  return envStr("X_ENABLED") === "true";
}

export function xMarketMode(): "filtered_stream" | "search" | "disabled" {
  if (!xMarketEnabled()) return "disabled";
  const mode = envStr("X_MODE");
  return mode === "search" ? "search" : "filtered_stream";
}

export function xMinImpactScore(): number {
  const raw = envStr("X_MIN_IMPACT_SCORE");
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 35;
}

export function xMarketStorageImpactThreshold(): number {
  const raw = envStr("X_STORAGE_MIN_IMPACT");
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 10;
}

function xApiBase(): string {
  return "https://api.twitter.com/2";
}

export async function getStreamRules(bearer: string): Promise<{ id: string; value: string; tag?: string }[]> {
  const res = await fetch(`${xApiBase()}/tweets/search/stream/rules`, {
    method: "GET",
    headers: { Authorization: `Bearer ${bearer}`, "User-Agent": "AetherIntelligence/0.1" },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { data?: Array<{ id: string; value: string; tag?: string }> };
  return data.data ?? [];
}

export async function setStreamRules(
  bearer: string,
  accounts: XMarketAccount[],
): Promise<{ ok: boolean; error?: string }> {
  // Remove existing rules first so stale usernames do not accumulate.
  const existing = await getStreamRules(bearer);
  if (existing.length) {
    const deleteBody = JSON.stringify({ delete: { ids: existing.map((r) => r.id) } });
    await fetch(`${xApiBase()}/tweets/search/stream/rules`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
        "User-Agent": "AetherIntelligence/0.1",
      },
      body: deleteBody,
    });
  }

  const enabled = accounts.filter((a) => a.enabled);
  const usernames = enabled.map((a) => `from:${a.username}`);
  const maxRuleValue = 480; // stay well under the 512-char rule limit
  const rules: { value: string; tag: string }[] = [];
  let current: string[] = [];
  for (const u of usernames) {
    const candidate = current.length ? `${current.join(" OR ")} OR ${u}` : u;
    if (candidate.length > maxRuleValue) {
      if (current.length) {
        rules.push({ value: current.join(" OR "), tag: `tier-mixed-${rules.length}` });
      }
      current = [u];
    } else {
      current.push(u);
    }
  }
  if (current.length) rules.push({ value: current.join(" OR "), tag: `tier-mixed-${rules.length}` });
  if (!rules.length) return { ok: true };

  const body = JSON.stringify({ add: rules });
  const res = await fetch(`${xApiBase()}/tweets/search/stream/rules`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
      "User-Agent": "AetherIntelligence/0.1",
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, error: `rule update failed: ${res.status} ${text.slice(0, 200)}` };
  }
  return { ok: true };
}

export function normalizeStreamTweet(obj: unknown): XPost | null {
  if (!obj || typeof obj !== "object") return null;
  const t = obj as Record<string, unknown>;
  const id = typeof t.id === "string" ? t.id : null;
  const text = typeof t.text === "string" ? t.text : null;
  if (!id || text == null) return null;
  const metrics = (t.public_metrics as Record<string, unknown>) ?? {};
  const createdAt = typeof t.created_at === "string" ? t.created_at : null;
  const authorId = typeof t.author_id === "string" ? t.author_id : null;
  const users = Array.isArray(t.users) ? (t.users as Array<Record<string, unknown>>) : [];
  const user = users.find((u) => String(u.id ?? "") === authorId) ?? {};
  const username = typeof user.username === "string" ? user.username : authorId ?? "unknown";
  const displayName = typeof user.name === "string" ? user.name : username;
  return {
    id,
    postId: id,
    username,
    displayName,
    body: text,
    url: `https://x.com/i/web/status/${id}`,
    publishedAt: createdAt,
    engagement: typeof metrics.like_count === "number" ? metrics.like_count : null,
  };
}

export async function* xStreamLines(
  bearer: string,
  signal?: AbortSignal,
): AsyncGenerator<unknown, void, unknown> {
  const url = `${xApiBase()}/tweets/search/stream?tweet.fields=created_at,public_metrics,author_id&expansions=author_id&user.fields=username`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${bearer}`, "User-Agent": "AetherIntelligence/0.1" },
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`stream connect failed: ${res.status} ${text.slice(0, 200)}`);
  }
  if (!res.body) throw new Error("stream has no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          yield JSON.parse(trimmed);
        } catch {
          // Ignore malformed keep-alive / heartbeat lines.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Refresh the live filtered-stream rules from the current watchlist. */
export async function refreshStreamRules(bearer: string): Promise<{ ok: boolean; error?: string }> {
  return setStreamRules(bearer, enabledWatchlist());
}
