import "dotenv/config";
import { prisma } from "@/lib/db";

// Bulk dev-data seeder: adds volume to the EXISTING login company
// (not demo-company). Idempotent: re-runs stop early when BULK data exists.
// Usage: npx tsx scripts/seed-bulk.ts [counts: products customers orders invoices]
// Defaults: 40 products, 200 customers, 300 orders, 120 invoices.

let seed = 42;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));

async function main() {
  const [nProd = 40, nCust = 200, nOrders = 300, nInv = 120] = process.argv
    .slice(2)
    .map(Number)
    .map((v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined))
    .map((v, i) => v ?? [40, 200, 300, 120][i]);

  const company = await prisma.company.findFirst({
    where: { users: { some: { username: "gayethtayem@gmail.com" } } },
  });
  if (!company) throw new Error("login company not found");
  const cid = company.id;
  console.log(`company: ${company.name} (${cid})`);

  const bulkMarker = await prisma.customer.findFirst({ where: { companyId: cid, code: "BULK-C-0001" } });
  const skipCustomers = !!bulkMarker;
  if (skipCustomers) console.log("customers: already present, skipping");

  const admin = await prisma.user.findFirst({ where: { companyId: cid, role: "Admin" } });
  const piece = await prisma.unit.findFirst({ where: { companyId: cid, name: "قطعة" } });
  const carton = await prisma.unit.findFirst({ where: { companyId: cid, name: "كرتون" } });
  const cat = await prisma.productCategory.findFirst({ where: { companyId: cid } });
  const sup = await prisma.supplier.findFirst({ where: { companyId: cid } });
  const depot = await prisma.store.findFirst({ where: { companyId: cid, kind: "DEPOT" }, orderBy: { createdAt: "asc" } });
  const vans = await prisma.store.findMany({ where: { companyId: cid, kind: "VAN" }, orderBy: { name: "asc" } });
  const secteur = await prisma.secteur.findFirst({ where: { companyId: cid } });
  const tier = await prisma.priceTier.findFirst({ where: { companyId: cid } });
  if (!admin || !piece || !carton || !cat || !sup || !depot) throw new Error("missing base rows (run normal seed first)");

  const now = new Date();
  const season = await prisma.season.upsert({
    where: { companyId_year_month: { companyId: cid, year: now.getFullYear(), month: now.getMonth() + 1 } },
    update: {},
    create: { companyId: cid, year: now.getFullYear(), month: now.getMonth() + 1, status: "open" },
  });

  // ── Products (+ depot opening batches) ──
  const factorChoices = [6, 12, 24, 36, 48];
  const prodIds: string[] = [];
  const salePrices = new Map<string, number>();
  const costPrices = new Map<string, number>();
  const bulkProdMarker = await prisma.product.findFirst({ where: { companyId: cid, reference: "BLK-001" } });
  if (!bulkProdMarker) {
  for (let i = 1; i <= nProd; i++) {
    const code = `BLK-${String(i).padStart(3, "0")}`;
    const factor = pick(factorChoices);
    const sale = int(45, 1500);
    const cost = Math.round(sale * (0.7 + rnd() * 0.15) * 100) / 100;
    const qty = int(50, 600);
    const p = await prisma.product.create({
      data: {
        companyId: cid, name: `منتج تجريبي ${code}`, reference: code,
        barcode: `613090${String(100000 + i)}`, categoryId: cat.id, supplierId: sup.id,
        baseUnitId: piece.id, saleUnitId: carton.id, purchaseUnitId: carton.id,
        salePrice: sale, costPrice: cost, minStock: int(10, 60), stockQty: qty,
        colisage: `1 كرتون = ${factor} قطعة`,
        conversions: { create: [{ unitId: carton.id, factor }] },
      },
    });
    await prisma.stockBatch.create({
      data: { companyId: cid, productId: p.id, storeId: depot.id, qty, initialQty: qty, unitCost: cost },
    });
    prodIds.push(p.id);
    salePrices.set(p.id, sale);
    costPrices.set(p.id, cost);
  }
  } else {
    const existing = await prisma.product.findMany({ where: { companyId: cid, reference: { startsWith: "BLK-" } }, select: { id: true, salePrice: true, costPrice: true } });
    for (const p of existing) {
      prodIds.push(p.id);
      salePrices.set(p.id, Number(p.salePrice));
      costPrices.set(p.id, Number(p.costPrice));
    }
    console.log(`products: reusing ${existing.length} existing BULK products`);
  }
  if (prodIds.length === 0) {
    console.log("products: nothing to add, aborting");
    return;
  }
  console.log(`products: ${bulkProdMarker ? "reused" : "+" + prodIds.length}`);

  // ── Van batches (so every van card shows stock/value) ──
  const vanBatchMarker = await prisma.stockBatch.findFirst({
    where: { companyId: cid, storeId: { in: vans.map((v) => v.id) }, product: { reference: { startsWith: "BLK-" } } },
    select: { id: true },
  });
  const existingProds = await prisma.product.findMany({
    where: { companyId: cid, id: { notIn: prodIds.length ? prodIds : ["__none__"] } },
    select: { id: true, salePrice: true, costPrice: true },
    take: 60,
  });
  for (const p of existingProds) {
    salePrices.set(p.id, Number(p.salePrice));
    costPrices.set(p.id, Number(p.costPrice));
  }
  const allProdIds = [...prodIds, ...existingProds.map((p) => p.id)];
  if (vanBatchMarker) {
    console.log("van batches: already present, skipping");
  } else {
  let vanBatches = 0;
  for (const v of vans) {
    const sample = [...allProdIds].sort(() => rnd() - 0.5).slice(0, 8);
    for (const pid of sample) {
      const q = int(5, 120);
      await prisma.stockBatch.create({
        data: { companyId: cid, productId: pid, storeId: v.id, qty: q, initialQty: q, unitCost: costPrices.get(pid) ?? 100 },
      });
      vanBatches++;
    }
  }
  console.log(`van batches: +${vanBatches} across ${vans.length} vans`);
  }

  // ── Customers ──
  const custIds: string[] = [];
  const existingCusts = await prisma.customer.findMany({ where: { companyId: cid }, select: { id: true }, take: 100 });
  custIds.push(...existingCusts.map((c) => c.id));
  if (!skipCustomers) {
  const custData = Array.from({ length: nCust }, (_, i) => ({
    companyId: cid,
    code: `BULK-C-${String(i + 1).padStart(4, "0")}`,
    name: `زبون تجريبي ${i + 1}`,
    phone: `0599${String(100000 + i)}`,
    wilayaCode: 16,
    secteurId: secteur?.id ?? null,
    tierId: tier?.id ?? null,
  }));
  await prisma.customer.createMany({ data: custData });
  }
  const bulkCusts = await prisma.customer.findMany({ where: { companyId: cid, code: { startsWith: "BULK-C-" } }, select: { id: true } });
  custIds.push(...bulkCusts.map((c) => c.id));
  console.log(`customers: ${skipCustomers ? "reused" : "+" + nCust} (pool: ${custIds.length})`);

  const locIds = [...vans.map((v) => v.id), depot.id];
  const day = 86400000;

  // ── Orders (CMD-9xxx, kind ORDER) ──
  const orderMarker = await prisma.sale.findFirst({ where: { companyId: cid, kind: "ORDER", number: "CMD-9001" }, select: { id: true } });
  if (orderMarker) {
    console.log("orders: already present, skipping");
  } else {
  for (let i = 1; i <= nOrders; i++) {
    const r = rnd();
    const status = r < 0.7 ? "DRAFT" : r < 0.9 ? "CONFIRMED" : "DELIVERED";
    const nLines = int(1, 4);
    const used = [...allProdIds].sort(() => rnd() - 0.5).slice(0, nLines);
    let total = 0;
    const lines = used.map((pid) => {
      const qty = int(1, 20);
      const price = salePrices.get(pid) ?? 100;
      const lineTotal = Math.round(qty * price * 100) / 100;
      total += lineTotal;
      return { productId: pid, qty, baseQty: qty, unitPrice: price, lineTotal };
    });
    await prisma.sale.create({
      data: {
        companyId: cid, seasonId: season.id, kind: "ORDER", status: status as never,
        number: `CMD-${9000 + i}`,
        clientId: pick(custIds), locationId: pick(locIds),
        createdById: admin.id,
        total: Math.round(total * 100) / 100, paid: 0,
        date: new Date(now.getTime() - int(0, 60) * day),
        lines: { create: lines },
      },
    });
    if (i % 100 === 0) console.log(`orders: ${i}/${nOrders}`);
  }
  }
  console.log(`orders: +${nOrders}`);

  // ── Purchase invoices (BULK-FAC-xxx) ──
  const invMarker = await prisma.purchaseInvoice.findFirst({ where: { companyId: cid, number: "BULK-FAC-0001" }, select: { id: true } });
  if (invMarker) {
    console.log("purchase invoices: already present, skipping");
  } else {
  const supIds = (await prisma.supplier.findMany({ where: { companyId: cid }, select: { id: true } })).map((s) => s.id);
  for (let i = 1; i <= nInv; i++) {
    const nLines = int(1, 3);
    const used = [...allProdIds].sort(() => rnd() - 0.5).slice(0, nLines);
    let total = 0;
    const lines = used.map((pid) => {
      const qty = int(10, 200);
      const price = costPrices.get(pid) ?? 80;
      const lineTotal = Math.round(qty * price * 100) / 100;
      total += lineTotal;
      return { productId: pid, qty, baseQty: qty, unitPrice: price, lineTotal };
    });
    total = Math.round(total * 100) / 100;
    const payR = rnd();
    const paid = payR < 0.33 ? total : payR < 0.66 ? Math.round((total / 2) * 100) / 100 : 0;
    await prisma.purchaseInvoice.create({
      data: {
        companyId: cid, seasonId: season.id, supplierId: pick(supIds),
        number: `BULK-FAC-${String(i).padStart(4, "0")}`,
        total, paid,
        date: new Date(now.getTime() - int(0, 90) * day),
        lines: { create: lines },
      },
    });
    if (i % 60 === 0) console.log(`invoices: ${i}/${nInv}`);
  }
  }
  console.log(`purchase invoices: +${nInv}`);
  console.log("BULK seed done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
