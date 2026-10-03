import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { getOrCreateSettings } from "@/lib/settings/helpers";

/// Alerts: low stock (global), expired + near-expiry batches (toggle-gated).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const settings = await getOrCreateSettings(session.companyId);

  const lowStock = await prisma.product.findMany({
    where: { companyId: session.companyId, isActive: true },
    select: { id: true, name: true, stockQty: true, minStock: true },
  }).then((rows) => rows.filter((p) => Number(p.stockQty) <= Number(p.minStock)).map((p) => ({
    productId: p.id,
    name: p.name,
    stock: Number(p.stockQty),
    min: Number(p.minStock),
  })));

  let expired: unknown[] = [];
  let expiring: unknown[] = [];
  if (settings.expiryEnabled) {
    const now = new Date();
    const soon = new Date();
    soon.setDate(soon.getDate() + 30);
    const [exp, near] = await Promise.all([
      prisma.stockBatch.findMany({
        where: { companyId: session.companyId, transferId: null, qty: { gt: 0 }, expiryDate: { lt: now } },
        include: { product: { select: { id: true, name: true } }, location: { select: { id: true, name: true } } },
        take: 100,
      }),
      prisma.stockBatch.findMany({
        where: { companyId: session.companyId, transferId: null, qty: { gt: 0 }, expiryDate: { gte: now, lte: soon } },
        include: { product: { select: { id: true, name: true } }, location: { select: { id: true, name: true } } },
        take: 100,
      }),
    ]);
    expired = exp;
    expiring = near;
  }

  const inTransit = await prisma.transfer.count({ where: { companyId: session.companyId, status: "DECLARED" } });

  const negatives = await prisma.stockBatch.groupBy({
    by: ["productId", "storeId"],
    where: { companyId: session.companyId, transferId: null },
    _sum: { qty: true },
  }).then(async (rows) => {
    const neg = rows.filter((r) => Number(r._sum.qty ?? 0) < -1e-9);
    if (!neg.length) return [];
    const prods = await prisma.product.findMany({
      where: { id: { in: neg.map((r) => r.productId) } },
      select: { id: true, name: true },
    });
    const locs = await prisma.store.findMany({
      where: { id: { in: neg.map((r) => r.storeId).filter(Boolean) as string[] } },
      select: { id: true, name: true },
    });
    return neg.map((r) => ({
      product: prods.find((p) => p.id === r.productId)?.name ?? r.productId,
      location: locs.find((l) => l.id === r.storeId)?.name ?? "?",
      qty: Number(r._sum.qty ?? 0),
    }));
  });

  return NextResponse.json({ lowStock, expired, expiring, inTransit, negatives, expiryOn: settings.expiryEnabled });
}
