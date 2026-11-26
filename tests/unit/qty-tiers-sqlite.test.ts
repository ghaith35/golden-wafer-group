import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sanitizeQtyTiers } from "@/lib/products/qty-tiers";

// Quantity ladder, end to end on the offline (SQLite) engine: the real sales
// service prices blank-price lines by the product's per-colisage ladder.

const require = createRequire(import.meta.url);
const root = mkdtempSync(join(tmpdir(), "distribuili-qty-e2e-"));
const dbFile = join(root, "e2e.db");

type Svc = typeof import("@/lib/sales/service");
type Db = typeof import("@/lib/db");
let svc: Svc, prisma: Db["prisma"];
const ids = { co: "", client: "", clientGros: "", pA: "", uBottle: "", uCarton: "", gros: "", superGros: "" };

beforeAll(async () => {
  const Database = require("libsql");
  const d = new Database(dbFile);
  d.exec(readFileSync(resolve(__dirname, "../../prisma/sqlite-init.sql"), "utf8"));
  d.close();
  process.env.DISTRIBUILI_DB = "local";
  process.env.DISTRIBUILI_SQLITE_URL = `file:${dbFile}`;
  process.env.DISTRIBUILI_SQLITE_CLIENT = resolve(__dirname, "../../src/generated/prisma-sqlite");
  prisma = (await import("@/lib/db")).prisma;
  svc = await import("@/lib/sales/service");

  const co = await prisma.company.create({ data: { name: "Qty Co" } });
  ids.co = co.id;
  await prisma.companySettings.create({ data: { companyId: co.id, creditSalesEnabled: true, pieceSalesEnabled: true } });
  ids.gros = (await prisma.priceTier.create({ data: { companyId: co.id, name: "Gros", sortOrder: 1 } })).id;
  ids.superGros = (await prisma.priceTier.create({ data: { companyId: co.id, name: "Super gros", sortOrder: 2 } })).id;
  ids.client = (await prisma.customer.create({ data: { companyId: co.id, code: "C1", name: "Retail client" } })).id;
  ids.clientGros = (await prisma.customer.create({ data: { companyId: co.id, code: "C2", name: "Gros client", tierId: ids.gros } })).id;
  ids.uBottle = (await prisma.unit.create({ data: { companyId: co.id, name: "Bottle" } })).id;
  ids.uCarton = (await prisma.unit.create({ data: { companyId: co.id, name: "Carton" } })).id;
  const p = await prisma.product.create({ data: { companyId: co.id, name: "Juice", salePrice: 120, baseUnitId: ids.uBottle } });
  ids.pA = p.id;
  await prisma.productUnitConversion.create({ data: { productId: p.id, unitId: ids.uCarton, factor: 12 } });
  await prisma.productTierPrice.createMany({
    data: [
      { productId: p.id, tierId: ids.gros, price: 110 },
      { productId: p.id, tierId: ids.superGros, price: 100 },
    ],
  });
  // Carton ladder: 0 → سعر البيع · 10 → gros · 50 → super gros. Bottles: none.
  await prisma.productQtyTier.createMany({
    data: [
      { productId: p.id, unitKey: ids.uCarton, minQty: 0, tierId: null },
      { productId: p.id, unitKey: ids.uCarton, minQty: 10, tierId: ids.gros },
      { productId: p.id, unitKey: ids.uCarton, minQty: 50, tierId: ids.superGros },
    ],
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(root, { recursive: true, force: true });
});

const priceOf = async (clientId: string, line: Record<string, unknown>) => {
  const order = await svc.createOrder(ids.co, { clientId, lines: [{ productId: ids.pA, ...line }] } as never);
  return Number(order.lines[0].unitPrice);
};

describe("quantity ladder — server prices blank-price lines per colisage", () => {
  it("re-tiers as the carton quantity grows", async () => {
    expect(await priceOf(ids.client, { unitId: ids.uCarton, qty: 1 })).toBe(1440); // 120 × 12
    expect(await priceOf(ids.client, { unitId: ids.uCarton, qty: 9 })).toBe(1440);
    expect(await priceOf(ids.client, { unitId: ids.uCarton, qty: 10 })).toBe(1320); // gros 110 × 12
    expect(await priceOf(ids.client, { unitId: ids.uCarton, qty: 49 })).toBe(1320);
    expect(await priceOf(ids.client, { unitId: ids.uCarton, qty: 50 })).toBe(1200); // super 100 × 12
  });
  it("the ladder belongs to the colisage: bottles (no ladder) keep the normal price", async () => {
    expect(await priceOf(ids.client, { unitId: ids.uBottle, qty: 500 })).toBe(120);
    expect(await priceOf(ids.client, { qty: 500 })).toBe(120); // no unit = base unit
  });
  it("a ladder overrides the client's own tier; units without a ladder still use it", async () => {
    expect(await priceOf(ids.clientGros, { unitId: ids.uCarton, qty: 1 })).toBe(1440); // ladder rung 0 = base
    expect(await priceOf(ids.clientGros, { unitId: ids.uBottle, qty: 1 })).toBe(110); // client tier applies
  });
  it("an explicit price (manual override) is never touched", async () => {
    expect(await priceOf(ids.client, { unitId: ids.uCarton, qty: 60, unitPrice: 999 })).toBe(999);
  });
  it("deleting a tier drops its rung to the base price instead of breaking the line", async () => {
    await prisma.priceTier.delete({ where: { id: ids.superGros } });
    expect(await priceOf(ids.client, { unitId: ids.uCarton, qty: 60 })).toBe(1440);
  });
});

describe("sanitizeQtyTiers", () => {
  const r = (unitKey: string, minQty: number, tierId: string | null) => ({ unitKey, minQty, tierId });
  it("keeps real colisages, drops unknown units and single-rung ladders", () => {
    const out = sanitizeQtyTiers([r("", 0, null), r("", 10, "g"), r("ghost", 0, null), r("ghost", 5, "g"), r("ctn", 0, null)], ["ctn"]);
    expect(out.map((x) => [x.unitKey, x.minQty])).toEqual([["", 0], ["", 10]]); // ctn has a single rung → dropped
  });
  it("sorts and de-duplicates by minQty", () => {
    const out = sanitizeQtyTiers([r("ctn", 50, "s"), r("ctn", 0, null), r("ctn", 10, "g"), r("ctn", 10, "x")], ["ctn"]);
    expect(out.map((x) => x.minQty)).toEqual([0, 10, 50]);
  });
  it("tolerates empty input", () => {
    expect(sanitizeQtyTiers(undefined, [])).toEqual([]);
  });
});
