import { HTTP_TIMEOUT_MS, USER_AGENT } from "./config.ts";

export type FetchResult<T> = {
  ok: boolean;
  status: number;
  latencyMs: number;
  data: T | null;
  error: string | null;
  url: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchJson<T = unknown>(
  url: string,
  opts: {
    timeoutMs?: number;
    retries?: number;
    headers?: Record<string, string>;
    method?: string;
    body?: string;
  } = {},
): Promise<FetchResult<T>> {
  const timeoutMs = opts.timeoutMs ?? HTTP_TIMEOUT_MS;
  const retries = opts.retries ?? 2;
  let lastErr = "request failed";
  let lastStatus = 0;
  const started = Date.now();

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    const hopStart = Date.now();
    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        body: opts.body,
        signal: ac.signal,
        headers: {
          Accept: "application/json, text/xml, application/rss+xml, */*",
          "User-Agent": USER_AGENT,
          ...(opts.headers ?? {}),
        },
        redirect: "follow",
      });
      lastStatus = res.status;
      const text = await res.text();
      if (res.status === 429 || res.status >= 500) {
        lastErr = `http ${res.status}`;
        const wait = Math.min(8000, 400 * 2 ** attempt);
        const ra = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(ra) ? ra * 1000 : wait);
        continue;
      }
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          latencyMs: Date.now() - hopStart,
          data: null,
          error: `http ${res.status}`,
          url,
        };
      }
      let data: T | null = null;
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = text as unknown as T;
      }
      return {
        ok: true,
        status: res.status,
        latencyMs: Date.now() - hopStart,
        data,
        error: null,
        url,
      };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : "network error";
      if (attempt < retries) await sleep(300 * 2 ** attempt);
    } finally {
      clearTimeout(t);
    }
  }

  return {
    ok: false,
    status: lastStatus,
    latencyMs: Date.now() - started,
    data: null,
    error: lastErr,
    url,
  };
}

export async function fetchText(
  url: string,
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<FetchResult<string>> {
  return fetchJson<string>(url, opts);
}

export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!, idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}
