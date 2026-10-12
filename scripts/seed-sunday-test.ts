import "dotenv/config";
import { prisma } from "@/lib/db";

// Sunday field-test data: client + product + depot stock + van transfer +
// Sunday journée (OPEN, unstarted — the driver starts it from the phone).
// Idempotent: every piece is skipped when already present, safe to re-run.
// Usage (server must be STOPPED — it holds the SQLite file):
//   DISTRIBUILI_DB=local DISTRIBUILI_SQLITE_URL="file:/path/distribuili.db" npx tsx scripts/seed-sunday-test.ts

const SUNDAY = new Date(2026, 9, 12); // Oct 12 2026, server-local midnight
const CLIENT_CODE = "CLT-0001";
const PRODUCT_REF = "PRD-001";
const TRANSFER_NO = "TRF-0001";
const DEPOT_QTY = 100;
const MOVE_QTY = 20;

async function main() {
  const company = await prisma.company.findFirst({ orderBy: { createdAt: "asc" } });
  if (!company) throw new Error("no company");
  const cid = company.id;
  console.log(`company: ${company.name} (${cid})`);

  const admin = await prisma.user.findFirst({ where: { companyId: cid, role: "Admin" } });
  if (!admin) throw new Error("no admin user");

  // 1. Unit
  const piece =
    (await prisma.unit.findFirst({ where: { companyId: cid, name: "Pièce" } })) ??
    (await prisma.unit.create({ data: { companyId: cid, name: "Pièce", symbol: "pc" } }));
  console.log(`unit: ${piece.name}`);

  // 2. Depot (transfer source)
  const depot =
    (await prisma.store.findFirst({ where: { companyId: cid, kind: "DEPOT" }, orderBy: { createdAt: "asc" } })) ??
    (await prisma.store.create({ data: { companyId: cid, name: "Dépôt Principal", kind: "DEPOT" } }));
  console.log(`depot: ${depot.name}`);

  // 3. Van (must already exist — the driver's assigned van)
  const van = await prisma.store.findFirst({ where: { companyId: cid, kind: "VAN" }, orderBy: { createdAt: "asc" } });
  if (!van) throw new Error("no VAN store — create a van in Vans first");
  console.log(`van: ${van.name} (${van.id})`);

  // 4. Client
  const client =
    (await prisma.customer.findFirst({ where: { companyId: cid, code: CLIENT_CODE } })) ??
    (await prisma.customer.create({
      data: { companyId: cid, code: CLIENT_CODE, name: "زبون تجريبي — الأحد", address: "Alger", creditLimit: 5000 },
    }));
  console.log(`client: ${client.code} ${client.name}`);

  // 5. Product + depot stock
  let product = await prisma.product.findFirst({ where: { companyId: cid, reference: PRODUCT_REF } });
  if (!product) {
    product = await prisma.product.create({
      data: {
        companyId: cid, name: "منتج تجريبي", reference: PRODUCT_REF,
        baseUnitId: piece.id, saleUnitId: piece.id,
        salePrice: 150, costPrice: 100, stockQty: DEPOT_QTY,
      },
    });
    await prisma.stockBatch.create({
      data: { companyId: cid, productId: product.id, storeId: depot.id, qty: DEPOT_QTY, initialQty: DEPOT_QTY, unitCost: 100 },
    });
    console.log(`product: ${product.name} (${PRODUCT_REF}) stock depot=${DEPOT_QTY}`);
  } else {
    console.log(`product: exists (${PRODUCT_REF})`);
  }

  // 6. Season for October 2026 (transfer FK)
  const season = await prisma.season.upsert({
    where: { companyId_year_month: { companyId: cid, year: 2026, month: 10 } },
    update: {},
    create: { companyId: cid, year: 2026, month: 10, status: "open" },
  });

  // 7. Transfer depot → van, CONFIRMED (net effect of declare+confirm:
  // depot -Q, van +Q, product.stockQty unchanged).
  let transfer = await prisma.transfer.findFirst({ where: { companyId: cid, number: TRANSFER_NO } });
  if (!transfer) {
    const depotBatch = await prisma.stockBatch.findFirst({
      where: { companyId: cid, productId: product.id, storeId: depot.id, transferId: null },
      orderBy: { createdAt: "asc" },
    });
    if (!depotBatch || Number(depotBatch.qty) < MOVE_QTY) throw new Error(`depot batch short (need ${MOVE_QTY})`);
    transfer = await prisma.transfer.create({
      data: {
        companyId: cid, seasonId: season.id, number: TRANSFER_NO,
        fromLocationId: depot.id, toLocationId: van.id,
        status: "CONFIRMED", declaredById: admin.id, confirmedById: admin.id,
        date: new Date(),
        lines: { create: [{ productId: product.id, declaredQty: MOVE_QTY, confirmedQty: MOVE_QTY }] },
      },
    });
    await prisma.stockBatch.update({ where: { id: depotBatch.id }, data: { qty: { decrement: MOVE_QTY } } });
    await prisma.stockBatch.create({
      data: { companyId: cid, productId: product.id, storeId: van.id, qty: MOVE_QTY, initialQty: MOVE_QTY, unitCost: Number(depotBatch.unitCost) },
    });
    await prisma.documentSequence.create({ data: { companyId: cid, storeId: null, type: "transfer", year: 0, nextNo: 2 } }).catch(() => {});
    console.log(`transfer: ${TRANSFER_NO} depot→van ${MOVE_QTY} CONFIRMED`);
  } else {
    console.log(`transfer: exists (${TRANSFER_NO}, ${transfer.status})`);
  }

  // 8. Sunday journée (OPEN, unstarted — driver starts it on the phone).
  const dayStart = new Date(SUNDAY);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  let tour = await prisma.tournee.findFirst({
    where: { companyId: cid, locationId: van.id, status: "OPEN", date: { gte: dayStart, lt: dayEnd } },
  });
  if (!tour) {
    tour = await prisma.tournee.create({
      data: {
        companyId: cid, locationId: van.id, date: dayStart, status: "OPEN",
        notes: "Journée test dimanche",
        stops: { create: [{ clientId: client.id, position: 0 }] },
      },
    });
    console.log(`tournee: Sunday 2026-10-12 OPEN + 1 stop (${client.code})`);
  } else {
    console.log(`tournee: exists (${tour.id})`);
    const hasStop = await prisma.tourneeStop.findFirst({ where: { tourneeId: tour.id, clientId: client.id } });
    if (!hasStop) {
      await prisma.tourneeStop.create({ data: { tourneeId: tour.id, clientId: client.id, position: 0 } });
      console.log(`tournee: stop added (${client.code})`);
    }
  }

  // 9. Reconcile product.stockQty = sum of batches (matches declare+confirm math).
  const batches = await prisma.stockBatch.findMany({ where: { companyId: cid, productId: product.id } });
  const total = batches.reduce((s, b) => s + Number(b.qty), 0);
  await prisma.product.update({ where: { id: product.id }, data: { stockQty: total } });
  const vanQty = batches.filter((b) => b.storeId === van.id).reduce((s, b) => s + Number(b.qty), 0);
  const depotQty = batches.filter((b) => b.storeId === depot.id).reduce((s, b) => s + Number(b.qty), 0);
  console.log(`stock: depot=${depotQty} van=${vanQty} total=${total}`);
  console.log("done — reopen the server, then Sync once on the phone to pull it all.");
}

main()
  .catch((e) => {
    console.error("FAILED:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
