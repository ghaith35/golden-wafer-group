import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/settings/helpers";

/// Latest free (3pack) lines given to clients — read-only log for the admin tab.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const lines = await prisma.saleLine.findMany({
    where: { isBonus: true, sale: { companyId: auth.session.companyId, status: { not: "CANCELLED" } } },
    orderBy: { sale: { date: "desc" } },
    take: 100,
    include: {
      product: { select: { name: true, images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } } } },
      sale: { select: { id: true, number: true, kind: true, date: true, client: { select: { name: true } } } },
    },
  });
  const unitIds = [...new Set(lines.map((l) => l.unitId).filter((x): x is string => !!x))];
  const units = unitIds.length ? await prisma.unit.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true } }) : [];
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  return NextResponse.json(
    lines.map((l) => ({
      id: l.id,
      date: l.sale.date,
      saleId: l.sale.id,
      number: l.sale.number,
      kind: l.sale.kind,
      client: l.sale.client?.name ?? null,
      product: l.product.name,
      imageUrl: l.product.images[0]?.url ?? null,
      unit: l.unitId ? unitName.get(l.unitId) ?? null : null,
      qty: Number(l.qty),
    })),
  );
}
