import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

/// Owner morning view: today + month sales, margin, debts, alerts, van ranking.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const companyId = session.companyId;
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [todaySales, monthSales, clientDebts, supplierDebts, vans] = await Promise.all([
    prisma.sale.aggregate({
      where: { companyId, kind: { in: ["DELIVERY", "TICKET"] }, status: "DELIVERED", date: { gte: dayStart } },
      _sum: { total: true, paid: true },
      _count: true,
    }),
    prisma.sale.findMany({
      where: { companyId, kind: { in: ["DELIVERY", "TICKET"] }, status: "DELIVERED", date: { gte: monthStart } },
      select: { total: true, locationId: true, lines: { select: { baseQty: true, unitCost: true } } },
    }),
    prisma.customer.aggregate({ where: { companyId, balance: { gt: 0 } }, _sum: { balance: true }, _count: true }),
    prisma.supplier.aggregate({ where: { companyId, balance: { gt: 0 } }, _sum: { balance: true }, _count: true }),
    prisma.store.findMany({ where: { companyId, kind: "VAN", isActive: true }, select: { id: true, name: true, matricule: true } }),
  ]);

  const monthTotal = monthSales.reduce((s, x) => s + Number(x.total), 0);
  const monthCogs = monthSales.reduce(
    (s, x) => s + x.lines.reduce((a, l) => a + Number(l.baseQty) * Number(l.unitCost), 0),
    0
  );
  const perVan = new Map<string, { total: number; count: number }>();
  for (const s of monthSales) {
    if (!s.locationId) continue;
    const e = perVan.get(s.locationId) ?? { total: 0, count: 0 };
    e.total += Number(s.total);
    e.count += 1;
    perVan.set(s.locationId, e);
  }
  const vanRanking = vans
    .map((v) => ({ ...v, ...(perVan.get(v.id) ?? { total: 0, count: 0 }) }))
    .sort((a, b) => b.total - a.total);

  const lowStock = await prisma.product.findMany({ where: { companyId, isActive: true }, select: { stockQty: true, minStock: true } })
    .then((rows) => rows.filter((p) => Number(p.stockQty) <= Number(p.minStock)).length);

  return NextResponse.json({
    today: { total: Number(todaySales._sum.total ?? 0), paid: Number(todaySales._sum.paid ?? 0), count: todaySales._count },
    month: { total: monthTotal, cogs: monthCogs, margin: monthTotal - monthCogs, count: monthSales.length },
    debts: {
      clients: Number(clientDebts._sum.balance ?? 0),
      clientsCount: clientDebts._count,
      suppliers: Number(supplierDebts._sum.balance ?? 0),
      suppliersCount: supplierDebts._count,
    },
    alerts: { lowStock },
    vanRanking,
  });
}
