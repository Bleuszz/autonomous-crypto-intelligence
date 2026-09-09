#!/usr/bin/env node
/**
 * Nitro bundles @electric-sql/pglite but not its sidecar WASM/data files.
 * Production preview (no DATABASE_URL) needs them next to the bundled module.
 * Deployed Vercel uses Neon when DATABASE_URL is set; these files are unused there.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "node_modules/@electric-sql/pglite/dist");
const DEST_DIRS = [
  join(ROOT, ".vercel/output/functions/__server.func/_libs"),
  join(ROOT, ".output/server"),
];
const FILES = ["pglite.data", "pglite.wasm", "initdb.wasm"];

let copied = 0;
for (const destDir of DEST_DIRS) {
  const parent = dirname(destDir);
  if (!existsSync(parent) && !existsSync(destDir)) continue;
  mkdirSync(destDir, { recursive: true });
  for (const name of FILES) {
    const src = join(SRC, name);
    if (!existsSync(src)) continue;
    copyFileSync(src, join(destDir, name));
    copied += 1;
  }
}
if (copied === 0) {
  console.warn("[pglite-assets] no destination directory yet — skip");
} else {
  console.log(`[pglite-assets] copied ${copied} sidecar file(s)`);
}
