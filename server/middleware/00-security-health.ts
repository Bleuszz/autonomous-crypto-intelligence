import { timingSafeEqual } from "node:crypto";
import { getSql } from "../../src/lib/db";

interface ServerEvent {
  url: URL;
  req: { method: string; headers: Headers };
}

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export default async function securityHealthMiddleware(
  event: ServerEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  if (event.url.pathname === "/internal/engine/tick") {
    if ((event.req.method ?? "GET").toUpperCase() !== "POST") return new Response("Method Not Allowed", { status: 405 });
    const expected = process.env.ENGINE_CONTROL_TOKEN?.trim() ?? "";
    const supplied = event.req.headers.get("x-engine-control") ?? "";
    if (!expected || !same(supplied, expected)) return new Response("Not Found", { status: 404 });
    try {
      const { ensureIngested } = await import("../../src/lib/aether/ingest");
      await ensureIngested(true);
      return new Response("ok", { status: 200, headers: { "cache-control": "no-store" } });
    } catch (error) {
      console.error("[engine] controlled tick failed:", error instanceof Error ? error.message : error);
      return new Response("failed", { status: 503 });
    }
  }

  if (event.url.pathname === "/healthz" || event.url.pathname === "/engine-healthz") {
    try {
      const sql = await getSql();
      await sql.query("select 1 as ok");
      if (event.url.pathname === "/engine-healthz") {
        const rows = await sql.query<{ last_success_at: string | null }>(
          "select last_success_at from runtime_heartbeats where job='ingestion'",
        );
        const age = rows[0]?.last_success_at ? Date.now() - new Date(rows[0].last_success_at).getTime() : Infinity;
        if (age > 12 * 60_000) return new Response("engine stale", { status: 503 });
      }
      return new Response("ok", { status: 200, headers: { "cache-control": "no-store" } });
    } catch {
      return new Response("unhealthy", { status: 503, headers: { "cache-control": "no-store" } });
    }
  }

  const username = process.env.DASHBOARD_USERNAME?.trim();
  const password = process.env.DASHBOARD_PASSWORD?.trim();
  if (!username || !password) return new Response("Dashboard authentication is not configured", { status: 503 });
  const header = event.req.headers.get("authorization") ?? "";
  let suppliedUser = "";
  let suppliedPassword = "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
      const split = decoded.indexOf(":");
      suppliedUser = split >= 0 ? decoded.slice(0, split) : "";
      suppliedPassword = split >= 0 ? decoded.slice(split + 1) : "";
    } catch {
      // Invalid credentials are handled below.
    }
  }
  if (!same(suppliedUser, username) || !same(suppliedPassword, password)) {
    return new Response("Authentication required", {
      status: 401,
      headers: { "www-authenticate": 'Basic realm="Aether seven-day paper desk"', "cache-control": "no-store" },
    });
  }
  return next();
}
