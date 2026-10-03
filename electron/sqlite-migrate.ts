// Offline SQLite schema migration for the Local (Electron) build.
//
// Fresh installs get the current schema from the seed DB (or DDL), but an
// EXISTING distribuili.db was created by an older build. When the schema gains
// tables/columns, the new code queries columns that don't exist yet → "no such
// column" crashes on every page. Prisma has no migrate path for the offline
// SQLite DB, so the app migrates itself on boot from the shipped DDL
// (prisma/sqlite-init.sql — generated from the same schema.prisma the code
// was built against, so it can never drift from the queries):
//   • missing tables  → CREATE TABLE
//   • missing columns → ALTER TABLE … ADD COLUMN …
//   • missing indexes → CREATE [UNIQUE] INDEX IF NOT EXISTS …
//
// Purely additive + idempotent; a failing statement is logged and skipped,
// never blocks startup.
//
// Pure logic (no Electron imports) so it can be unit-tested in plain Node.
export interface MigrateResult {
  addedTables: string[];
  addedColumns: string[];
  addedIndexes: string[];
  skipped: string[];
}

export function migrateSqliteSchema(
  dbPath: string,
  ddl: string,
  log: (msg: string) => void,
): MigrateResult {
  const result: MigrateResult = { addedTables: [], addedColumns: [], addedIndexes: [], skipped: [] };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("libsql");
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const dbc: any = new Database(dbPath, {});
  try {
    const stmts = ddl
      .split(/;\r?\n/)
      .map((s) => s.replace(/--[^\n]*\n/g, "").trim())
      .map((s) => (s.endsWith(";") ? s.slice(0, -1).trim() : s))
      .filter(Boolean);
    for (const st of stmts) {
      try {
        const t = /^CREATE TABLE "([^"]+)" \(([\s\S]*)\)$/.exec(st);
        if (t) {
          const [, name, body] = t;
          const exists = dbc.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
          if (!exists) {
            dbc.exec(`CREATE TABLE "${name}" (${body})`);
            result.addedTables.push(name);
            log(`[db-migrate] created table ${name}`);
            continue;
          }
          const have = new Set(
            (dbc.prepare(`PRAGMA table_info("${name}")`).all() as any[]).map((r) => String(r.name)),
          );
          for (const def of splitTopLevel(body)) {
            const cm = /^"([^"]+)" ([\s\S]*)$/.exec(def);
            if (!cm) continue; // table-level constraint, not a column
            if (have.has(cm[1])) continue;
            try {
              dbc.exec(`ALTER TABLE "${name}" ADD COLUMN ${def}`);
              result.addedColumns.push(`${name}.${cm[1]}`);
              log(`[db-migrate] added column ${name}.${cm[1]}`);
            } catch (e) {
              result.skipped.push(`${name}.${cm[1]}: ${e}`);
              log(`[db-migrate] skip column ${name}.${cm[1]}: ${e}`);
            }
          }
          continue;
        }
        const ix = /^CREATE (UNIQUE )?INDEX "([^"]+)" (ON [\s\S]+)$/.exec(st);
        if (ix) {
          const exists = dbc.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(ix[2]);
          if (!exists) {
            dbc.exec(`CREATE ${ix[1] ?? ""}INDEX "${ix[2]}" ${ix[3]}`);
            result.addedIndexes.push(ix[2]);
            log(`[db-migrate] created index ${ix[2]}`);
          }
          continue;
        }
        // Anything else in the DDL (unexpected) — ignore silently.
      } catch (e) {
        result.skipped.push(`statement: ${String(e).slice(0, 120)}`);
        log(`[db-migrate] skip statement: ${String(e).slice(0, 160)}`);
      }
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
  } finally {
    try { dbc.close(); } catch { /* noop */ }
  }
  return result;
}

// Split a CREATE TABLE body on top-level commas (ignores commas inside
// parens and inside quoted identifiers / string literals).
export function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  let quote: string | null = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
