// Builds prisma/sqlite-seed.db — a fresh SQLite database with the schema +
// the base reference data seeded, ready to bundle into the offline (Local)
// desktop installer. On first run the app copies this file instead of
// creating empty tables, so the shop opens ready to log in.
//
// Prereqs: db:sqlite:build (SQLite client + sqlite-init.sql).
import { rmSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DDL = resolve(ROOT, "prisma/sqlite-init.sql");
const SEED_DB = resolve(ROOT, "prisma/sqlite-seed.db");
const fileUrl = `file:${SEED_DB.replace(/\\/g, "/")}`;

for (const suffix of ["", "-journal", "-wal", "-shm"]) {
  rmSync(SEED_DB + suffix, { force: true });
}

// 1) Create the schema.
{
  const c = createClient({ url: fileUrl });
  await c.executeMultiple(readFileSync(DDL, "utf8"));
  c.close();
}

// 2) Seed the base data into it (reuses the same seeders as the server).
const { spawnSync } = await import("node:child_process");
const r = spawnSync("npx", ["tsx", "prisma/seed.ts"], {
  cwd: ROOT,
  stdio: "inherit",
  shell: true, // Windows: resolve npx.cmd
  env: {
    ...process.env,
    DISTRIBUILI_DB: "local",
    DISTRIBUILI_SQLITE_URL: fileUrl,
    DISTRIBUILI_SQLITE_CLIENT: resolve(ROOT, "src/generated/prisma-sqlite"),
  },
});
if (r.status !== 0) process.exit(r.status ?? 1);

const mb = (statSync(SEED_DB).size / 1024 / 1024).toFixed(1);
console.log(`\n✓ prisma/sqlite-seed.db built (schema + base data, ${mb} MB)`);
