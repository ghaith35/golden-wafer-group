// Prepares the Next.js standalone output for Electron packaging.
//
// `next build` with output:"standalone" emits a self-contained server but does
// NOT copy static assets — they must be placed next to server.js. This also
// confirms the offline-DB resources (generated SQLite client + DDL + seed DB)
// were traced in via next.config's outputFileTracingIncludes.
import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const STANDALONE = resolve(ROOT, ".next/standalone");

if (!existsSync(resolve(STANDALONE, "server.js"))) {
  console.error("Missing .next/standalone/server.js — run `next build` first.");
  process.exit(1);
}

// Static assets (CSS/JS chunks) and public/ files.
cpSync(resolve(ROOT, ".next/static"), resolve(STANDALONE, ".next/static"), {
  recursive: true,
});
if (existsSync(resolve(ROOT, "public"))) {
  cpSync(resolve(ROOT, "public"), resolve(STANDALONE, "public"), { recursive: true });
}

// Sanity-check the offline-DB resources that Electron's first run depends on.
const required = [
  ".next/standalone/prisma/sqlite-init.sql",
  ".next/standalone/src/generated/prisma-sqlite/index.js",
  ".next/standalone/prisma/sqlite-seed.db",
];
const missing = required.filter((p) => !existsSync(resolve(ROOT, p)));
if (missing.length) {
  console.error(
    "Standalone is missing offline-DB resources (check next.config tracing):\n  " +
      missing.join("\n  "),
  );
  process.exit(1);
}

console.log("✓ standalone prepared for Electron (static, public, offline-db resources).");
