import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { migrateSqliteSchema } from "../../electron/sqlite-migrate";

const require = createRequire(import.meta.url);

// The desktop (Electron) app works fully offline on a local SQLite file. An
// install made BEFORE 3pack must pick up the new tables/columns on boot, with
// its existing sales and settings left untouched.
describe("3pack: offline desktop SQLite upgrade", () => {
  it("adds the 3pack tables + columns to an existing pre-3pack database", () => {
    const ddl = readFileSync(join(__dirname, "../../prisma/sqlite-init.sql"), "utf8");
    const root = mkdtempSync(join(tmpdir(), "distribuili-3pack-"));
    const file = join(root, "old-install.db");
    const Database = require("libsql");
    const old = new Database(file);
    // Old shapes: no threePackEnabled / isBonus / bonusRuleId, no 3pack tables.
    old.exec(`
      CREATE TABLE "company_settings" ("id" TEXT PRIMARY KEY, "companyId" TEXT, "currency" TEXT);
      INSERT INTO "company_settings" VALUES ('s1', 'co', 'DZD');
      CREATE TABLE "sale_lines" ("id" TEXT PRIMARY KEY, "saleId" TEXT, "productId" TEXT, "qty" DECIMAL, "unitPrice" DECIMAL);
      INSERT INTO "sale_lines" VALUES ('l1', 'sale1', 'p1', 2, 1200);
    `);
    old.close();
    try {
      const r = migrateSqliteSchema(file, ddl, () => {});
      expect(r.addedTables).toEqual(expect.arrayContaining(["three_pack_rules", "three_pack_items"]));
      expect(r.addedColumns).toEqual(expect.arrayContaining(["company_settings.threePackEnabled", "sale_lines.isBonus", "sale_lines.bonusRuleId"]));

      const db = new Database(file);
      // existing data untouched, new columns take their defaults (feature OFF, not a gift)
      expect(db.prepare('SELECT "currency", "threePackEnabled" FROM "company_settings"').get()).toMatchObject({ currency: "DZD", threePackEnabled: 0 });
      expect(db.prepare('SELECT "qty", "isBonus", "bonusRuleId" FROM "sale_lines"').get()).toMatchObject({ qty: 2, isBonus: 0, bonusRuleId: null });
      // rules table is created with the versioning column
      const cols = (db.prepare('PRAGMA table_info("three_pack_rules")').all() as Array<{ name: string }>).map((c) => c.name);
      expect(cols).toEqual(expect.arrayContaining(["id", "companyId", "name", "mode", "isActive", "isArchived"]));
      db.close();

      // idempotent: a second boot changes nothing
      const again = migrateSqliteSchema(file, ddl, () => {});
      expect(again.addedTables.filter((t) => t.startsWith("three_pack"))).toEqual([]);
      expect(again.addedColumns.filter((c) => /threePack|isBonus|bonusRuleId/.test(c))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
