import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

const productSelect = {
  select: {
    id: true,
    name: true,
    baseUnit: { select: { name: true } },
    conversions: { select: { unitId: true, factor: true, unit: { select: { name: true } } } },
  },
} as const;

function dayRange(dateStr: string | null) {
  const base = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : new Date().toISOString().slice(0, 10);
  const start = new Date(`${base}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const van = await prisma.store.findFirst({ where: { id, companyId: session.companyId, kind: "VAN" }, select: { id: true } });
  if (!van) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { searchParams } = new URL(req.url);
  const { start, end } = dayRange(searchParams.get("date"));
  const cid = session.companyId;

  const [transfers, sales, returns, losses] = await Promise.all([
    prisma.transfer.findMany({
      where: { companyId: cid, OR: [{ fromLocationId: id }, { toLocationId: id }], date: { gte: start, lt: end } },
      include: {
        lines: { include: { product: productSelect } },
        fromLocation: { select: { id: true, name: true } },
        toLocation: { select: { id: true, name: true } },
      },
      orderBy: { date: "asc" },
    }),
    prisma.sale.findMany({
      where: { companyId: cid, locationId: id, date: { gte: start, lt: end }, status: { notIn: ["DRAFT", "CANCELLED"] } },
      include: {
        client: { select: { name: true } },
        lines: { include: { product: productSelect } },
      },
      orderBy: { date: "asc" },
    }),
    prisma.clientReturn.findMany({
      where: { companyId: cid, locationId: id, date: { gte: start, lt: end } },
      include: {
        client: { select: { name: true } },
        lines: { include: { product: productSelect } },
      },
      orderBy: { date: "asc" },
    }),
    prisma.stockLoss.findMany({
      where: { companyId: cid, locationId: id, date: { gte: start, lt: end } },
      include: { product: productSelect },
      orderBy: { date: "asc" },
    }),
  ]);

  const num = (v: unknown) => Number(v ?? 0);
  return NextResponse.json({
    transfers: transfers.map((t) => ({
      ...t,
      cashAmount: num(t.cashAmount),
      lines: t.lines.map((l) => ({
        ...l,
        declaredQty: num(l.declaredQty),
        confirmedQty: l.confirmedQty != null ? num(l.confirmedQty) : null,
        product: { ...l.product, conversions: l.product.conversions.map((c) => ({ ...c, factor: num(c.factor) })) },
      })),
    })),
    sales: sales.map((s) => ({
      ...s,
      total: num(s.total),
      lines: s.lines.map((l) => ({
        ...l,
        qty: num(l.qty),
        baseQty: num(l.baseQty),
        product: { ...l.product, conversions: l.product.conversions.map((c) => ({ ...c, factor: num(c.factor) })) },
      })),
    })),
    returns: returns.map((r) => ({
      ...r,
      lines: r.lines.map((l) => ({
        ...l,
        baseQty: num(l.baseQty),
        product: { ...l.product, conversions: l.product.conversions.map((c) => ({ ...c, factor: num(c.factor) })) },
      })),
    })),
    losses: losses.map((l) => ({
      ...l,
      baseQty: num(l.baseQty),
      product: { ...l.product, conversions: l.product.conversions.map((c) => ({ ...c, factor: num(c.factor) })) },
    })),
  });
}
