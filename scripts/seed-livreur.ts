/// Local dev helper: make a livreur ready to sell RIGHT NOW.
///   npx tsx scripts/seed-livreur.ts [username]      (default: the first Livreur)
/// Idempotent and additive — it never deletes anything:
///   • the livreur gets a van (reuses his own, else claims a free one)
///   • the van is stocked with sellable products (topped up to a floor, never lowered)
///   • today's tour is OPEN with the clients of one sector (skipped when one already exists)
import { prisma } from "@/lib/db";
import { algiersDayKey } from "@/lib/tournees/days";

const STOCK_FLOOR = 120; // base units per product kept in the van
const PRODUCTS = 14;
const STOPS = 12;

async function main() {
  const wanted = process.argv[2];
  const user = await prisma.user.findFirst({
    where: { role: "Livreur", isActive: true, ...(wanted ? { username: wanted } : {}) },
    orderBy: { createdAt: "asc" },
  });
  if (!user) throw new Error(`No active Livreur${wanted ? ` named "${wanted}"` : ""} found.`);
  const companyId = user.companyId;

  // ── Van ──
  let van = await prisma.store.findFirst({ where: { companyId, kind: "VAN", isActive: true, userId: user.id } });
  if (!van) {
    van = await prisma.store.findFirst({ where: { companyId, kind: "VAN", isActive: true, userId: null }, orderBy: { name: "asc" } });
    if (!van) throw new Error("No free van to assign.");
    van = await prisma.store.update({ where: { id: van.id }, data: { userId: user.id } });
  }

  // ── Van stock ──
  const products = await prisma.product.findMany({
    where: { companyId, isActive: true, salePrice: { gt: 0 } },
    orderBy: { name: "asc" },
    take: PRODUCTS,
  });
  let topped = 0;
  for (const p of products) {
    const have = await prisma.stockBatch.aggregate({
      where: { companyId, productId: p.id, storeId: van.id, transferId: null, qty: { gt: 0 } },
      _sum: { qty: true },
    });
    const missing = STOCK_FLOOR - Number(have._sum.qty ?? 0);
    if (missing <= 0) continue;
    const cost = Number((p as unknown as { costPrice?: unknown }).costPrice ?? 0) || Number(p.salePrice) * 0.8;
    await prisma.stockBatch.create({
      data: { companyId, productId: p.id, storeId: van.id, qty: missing, initialQty: missing, unitCost: cost },
    });
    topped++;
  }

  // ── Today's OPEN tour ──
  const todayKey = algiersDayKey(new Date());
  const dayStart = new Date(`${todayKey}T00:00:00Z`);
  const dayEnd = new Date(`${todayKey}T23:59:59.999Z`);
  const existing = await prisma.tournee.findFirst({
    where: { companyId, locationId: van.id, date: { gte: dayStart, lte: dayEnd }, status: "OPEN" },
  });
  let stops = 0;
  if (!existing) {
    // The sector with the most active clients (so the tour looks real).
    const bySector = await prisma.customer.groupBy({
      by: ["secteurId"],
      where: { companyId, isActive: true, secteurId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { secteurId: "desc" } },
      take: 1,
    });
    const secteurId = bySector[0]?.secteurId ?? null;
    const clients = await prisma.customer.findMany({
      where: { companyId, isActive: true, ...(secteurId ? { secteurId } : {}) },
      orderBy: { name: "asc" },
      take: STOPS,
      select: { id: true },
    });
    await prisma.tournee.create({
      data: {
        companyId, date: dayStart, locationId: van.id, secteurId, status: "OPEN", slot: 0,
        notes: "Seed — tournée de démonstration",
        stops: { create: clients.map((c, i) => ({ clientId: c.id, position: i })) },
      },
    });
    stops = clients.length;
  }

  console.log(`Livreur "${user.username}" is ready:`);
  console.log(`  van      : ${van.name}`);
  console.log(`  stock    : ${products.length} products (floor ${STOCK_FLOOR}), ${topped} topped up`);
  console.log(`  tour     : ${existing ? "an OPEN tour already exists today" : `created for ${todayKey} with ${stops} stops`}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
