const appUrl = process.env.ENGINE_APP_URL || "http://app:3000";
const token = process.env.ENGINE_CONTROL_TOKEN;
const intervalMs = Number(process.env.INGEST_POLL_MS || 180000);
if (!token) throw new Error("ENGINE_CONTROL_TOKEN is required");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await sleep(15000);
for (;;) {
  const started = Date.now();
  try {
    const response = await fetch(`${appUrl}/internal/engine/tick`, {
      method: "POST",
      headers: { "x-engine-control": token },
      signal: AbortSignal.timeout(150000),
    });
    if (!response.ok) throw new Error(`tick returned ${response.status}`);
    console.log(`[engine-worker] tick OK in ${Date.now() - started}ms`);
  } catch (error) {
    console.error("[engine-worker] tick failed:", error instanceof Error ? error.message : error);
  }
  await sleep(Math.max(15000, intervalMs - (Date.now() - started)));
}
