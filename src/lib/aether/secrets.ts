const FLAG = Symbol.for("aether.runtimeSecrets");

/**
 * Load gitignored `secrets/runtime.env` into process.env when a key is unset.
 * Never logs values. Bearer tokens are used as stored — do not URI-decode them.
 */
export async function loadRuntimeSecrets(): Promise<void> {
  if (typeof window !== "undefined") return;
  const g = globalThis as typeof globalThis & { [FLAG]?: boolean };
  if (g[FLAG]) return;
  g[FLAG] = true;
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const candidates = [
      path.join(process.cwd(), "secrets/runtime.env"),
      "/workspace/secrets/runtime.env",
    ];
    for (const file of candidates) {
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, "utf8");
      for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq < 1) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = value;
      }
      break;
    }
  } catch {
    // missing file is fine — public providers still run
  }
}

export function xBearer(): string | undefined {
  const v = typeof process === "undefined" ? undefined : process.env.X_BEARER_TOKEN?.trim();
  return v || undefined;
}
