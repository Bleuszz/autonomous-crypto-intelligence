// Nitro loads this plugin during server startup, so the autonomous engine does
// not depend on a browser request importing the dashboard API module first.
import { ensureIngested } from "../../src/lib/aether/ingest";
import { initializeRuntime } from "../../src/lib/aether/runtime";

export default async function aetherEnginePlugin(): Promise<void> {
  await initializeRuntime();
  void ensureIngested(false).catch((error) => {
    console.error("[aether] initial ingest failed:", error instanceof Error ? error.message : error);
  });
}
