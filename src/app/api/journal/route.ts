import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { ensureCurrentSeason } from "@/lib/season/seasons";

/// Daily journal: per-day sales / versements / expenses + per-van sales.
/// Sales counted at delivery (DELIVERY + TICKET, not DRAFT orders).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const now = new Date();
  const year = Number(searchParams.get("year") ?? now.getFullYear());
  const month = Number(searchParams.get("month") ?? now.getMonth() + 1);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);

  const season = await ensureCurrentSeason(session.companyId);
  const where = { companyId: session.companyId, date: { gte: start, lt: end } };

  const [sales, versements, expenses, locations] = await Promise.all([
    prisma.sale.findMany({
      where: { ...where, kind: { in: ["DELIVERY", "TICKET"] }, status: "DELIVERED" },
      select: { date: true, total: true, paid: true, locationId: true, channel: true },
    }),
    prisma.versement.findMany({ where, select: { date: true, amount: true, kind: true } }),
    prisma.expense.findMany({ where: { companyId: session.companyId, deletedAt: null, expenseDate: { gte: start, lt: end } }, select: { expenseDate: true, amount: true } }),
    prisma.store.findMany({ where: { companyId: session.companyId }, select: { id: true, name: true, kind: true } }),
  ]);

  const day = (d: Date) => d.toISOString().slice(0, 10);
  const salesByDay: Record<string, number> = {};
  const paidByDay: Record<string, number> = {};
  const perVan: Record<string, Record<string, number>> = {};
  for (const s of sales) {
    const k = day(s.date);
    salesByDay[k] = (salesByDay[k] ?? 0) + Number(s.total);
    paidByDay[k] = (paidByDay[k] ?? 0) + Number(s.paid);
    if (s.locationId) {
      perVan[k] = perVan[k] ?? {};
      perVan[k][s.locationId] = (perVan[k][s.locationId] ?? 0) + Number(s.total);
    }
  }
  const versementsByDay: Record<string, number> = {};
  for (const v of versements) {
    const k = day(v.date);
    versementsByDay[k] = (versementsByDay[k] ?? 0) + Number(v.amount);
  }
  const expensesByDay: Record<string, number> = {};
  for (const e of expenses) {
    const k = day(e.expenseDate);
    expensesByDay[k] = (expensesByDay[k] ?? 0) + Number(e.amount);
  }

  return NextResponse.json({
    season,
    salesByDay,
    paidByDay,
    versementsByDay,
    expensesByDay,
    perVan,
    locations,
    monthTotal: {
      sales: Object.values(salesByDay).reduce((a, b) => a + b, 0),
      paid: Object.values(paidByDay).reduce((a, b) => a + b, 0),
      versements: Object.values(versementsByDay).reduce((a, b) => a + b, 0),
      expenses: Object.values(expensesByDay).reduce((a, b) => a + b, 0),
    },
  });
}
