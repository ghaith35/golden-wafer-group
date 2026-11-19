import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { migrateSqliteSchema } from "../../electron/sqlite-migrate";

const require = createRequire(import.meta.url);

describe("packaged SQLite upgrade", () => {
  it("uses the standalone driver to upgrade an existing client table", () => {
    const root = mkdtempSync(join(tmpdir(), "distribuili-driver-"));
    const standalone = join(root, "standalone");
    const driver = join(standalone, "node_modules", "libsql");
    mkdirSync(driver, { recursive: true });
    writeFileSync(join(standalone, "package.json"), "{}");
    writeFileSync(join(driver, "index.js"), `module.exports = require(${JSON.stringify(require.resolve("libsql"))});`);
    const Database = require("libsql");
    const file = join(root, "existing.db");
    let db = new Database(file);
    db.exec('CREATE TABLE "customers" ("id" TEXT PRIMARY KEY, "name" TEXT); INSERT INTO "customers" VALUES (\'old-client\', \'Existing client\');');
    db.close();
    try {
      const ddl = 'CREATE TABLE "customers" ("id" TEXT PRIMARY KEY, "name" TEXT, "legacyQr" TEXT);\n';
      const result = migrateSqliteSchema(file, ddl, () => {}, standalone);
      expect(result.addedColumns).toEqual(["customers.legacyQr"]);
      expect(result.skipped).toEqual([]);
      db = new Database(file);
      expect(db.prepare('SELECT "name", "legacyQr" FROM "customers"').get()).toMatchObject({ name: "Existing client", legacyQr: null });
      db.close();
      expect(migrateSqliteSchema(file, ddl, () => {}, standalone).addedColumns).toEqual([]);
      expect(() => migrateSqliteSchema(file, ddl, () => {}, join(root, "missing-driver"))).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
