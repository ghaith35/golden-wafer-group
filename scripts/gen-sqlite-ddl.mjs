// Generates prisma/sqlite-init.sql (CREATE TABLE DDL) from the SQLite schema,
// then fixes two Prisma SQLite-DDL quirks that break libSQL execution:
//   • JSON object/array defaults emitted unquoted: DEFAULT {}  -> DEFAULT '{}'
//                                                  DEFAULT []  -> DEFAULT '[]'
// Used by the Electron first-run bootstrap to create the local database.
// Run after gen-sqlite-schema.mjs (see `db:sqlite:build`).

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = resolve(ROOT, "prisma/schema.sqlite.prisma");
const OUT = resolve(ROOT, "prisma/sqlite-init.sql");

execFileSync(
  "npx",
  ["prisma", "migrate", "diff", "--from-empty", "--to-schema", SCHEMA, "--script", "-o", OUT],
  { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"], shell: true },
);

let sql = readFileSync(OUT, "utf8");
sql = sql.replace(/DEFAULT \{\}/g, "DEFAULT '{}'").replace(/DEFAULT \[\]/g, "DEFAULT '[]'");
writeFileSync(OUT, sql);

console.log(`Wrote ${OUT} (${(sql.match(/CREATE TABLE/g) || []).length} tables).`);
