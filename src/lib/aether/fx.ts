import { fetchJson } from "./http.ts";
import type { FxQuote } from "./capital.ts";

/** Frankfurter is a public ECB-derived FX API. No key. Never invent a rate. */
export async function fetchGbpUsd(): Promise<{ quote: FxQuote | null; error: string | null; latencyMs: number }> {
  const t0 = Date.now();
  try {
    const j = await fetchJson<{ rates?: { USD?: number } }>("https://api.frankfurter.app/latest?from=GBP&to=USD", {
      timeoutMs: 8_000,
    });
    const rate = j.ok && j.data?.rates?.USD;
    if (!j.ok || !(typeof rate === "number" && rate > 0)) {
      return { quote: null, error: "DATA UNAVAILABLE: GBPUSD", latencyMs: Date.now() - t0 };
    }
    return {
      quote: { gbpUsd: rate, observedAt: new Date().toISOString(), source: "frankfurter" },
      error: null,
      latencyMs: Date.now() - t0,
    };
  } catch (e) {
    return {
      quote: null,
      error: e instanceof Error ? e.message : "DATA UNAVAILABLE: GBPUSD",
      latencyMs: Date.now() - t0,
    };
  }
}
