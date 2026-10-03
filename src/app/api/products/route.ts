import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { productSchema } from "@/lib/products/validation";

function empty(v: string | null | undefined): string | undefined {
  const t = (v ?? "").trim();
  return t ? t : undefined;
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const categoryId = searchParams.get("categoryId");
  const rows = await prisma.product.findMany({
    where: {
      companyId: session.companyId,
      ...(categoryId ? { categoryId } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { barcode: { contains: q } },
              { reference: { contains: q } },
              { conversions: { some: { barcode: q } } },
            ],
          }
        : {}),
    },
    include: {
      images: { orderBy: { sortOrder: "asc" } },
      category: true,
      baseUnit: true,
      saleUnit: true,
      purchaseUnit: true,
      conversions: { include: { unit: true } },
      tierPrices: { include: { tier: true } },
    },
    orderBy: { name: "asc" },
    take: 200,
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = productSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  const d = parsed.data;

  // Scoped lookups: category / supplier / units / tiers must belong to the company.
  const [category, supplier, baseUnit] = await Promise.all([
    d.categoryId ? prisma.productCategory.findFirst({ where: { id: d.categoryId, companyId: session.companyId } }) : null,
    d.supplierId ? prisma.supplier.findFirst({ where: { id: d.supplierId, companyId: session.companyId } }) : null,
    d.baseUnitId ? prisma.unit.findFirst({ where: { id: d.baseUnitId, companyId: session.companyId } }) : null,
  ]);
  if (d.categoryId && !category) return NextResponse.json({ error: "bad_category" }, { status: 400 });
  if (d.supplierId && !supplier) return NextResponse.json({ error: "bad_supplier" }, { status: 400 });
  if (d.baseUnitId && !baseUnit) return NextResponse.json({ error: "bad_unit" }, { status: 400 });

  const unitIds = [...new Set((d.conversions ?? []).map((c) => c.unitId))];
  const units = unitIds.length
    ? await prisma.unit.findMany({ where: { id: { in: unitIds }, companyId: session.companyId } })
    : [];
  if (units.length !== unitIds.length) return NextResponse.json({ error: "bad_unit" }, { status: 400 });

  // Default sale/purchase units must be the base unit or one of the conversions.
  const allowedUnits = new Set([...(d.baseUnitId ? [d.baseUnitId] : []), ...unitIds]);
  for (const key of ["saleUnitId", "purchaseUnitId"] as const) {
    const v = d[key];
    if (v && !allowedUnits.has(v)) return NextResponse.json({ error: "bad_unit" }, { status: 400 });
  }

  const tierIds = [...new Set((d.tierPrices ?? []).map((t) => t.tierId))];
  const tiers = tierIds.length
    ? await prisma.priceTier.findMany({ where: { id: { in: tierIds }, companyId: session.companyId } })
    : [];
  if (tiers.length !== tierIds.length) return NextResponse.json({ error: "bad_tier" }, { status: 400 });

  const row = await prisma.product.create({
    data: {
      companyId: session.companyId,
      name: d.name.trim(),
      reference: empty(d.reference ?? null) ? d.reference!.trim() : null,
      barcode: empty(d.barcode ?? null) ? d.barcode!.trim() : null,
      colisage: empty(d.colisage ?? null) ? d.colisage!.trim() : null,
      categoryId: d.categoryId ?? null,
      supplierId: d.supplierId ?? null,
      baseUnitId: d.baseUnitId ?? null,
      saleUnitId: d.saleUnitId ?? null,
      purchaseUnitId: d.purchaseUnitId ?? null,
      minStock: d.minStock ?? 0,
      salePrice: d.salePrice ?? 0,
      costPrice: d.costPrice ?? 0,
      isActive: d.isActive ?? true,
      images: { create: (d.images ?? []).map((url, i) => ({ url, sortOrder: i })) },
      conversions: { create: (d.conversions ?? []).map((c) => ({ unitId: c.unitId, factor: c.factor, barcode: c.barcode?.trim() || null })) },
      tierPrices: { create: (d.tierPrices ?? []).map((t) => ({ tierId: t.tierId, price: t.price })) },
    },
    include: { images: { orderBy: { sortOrder: "asc" } } },
  });
  return NextResponse.json(row, { status: 201 });
}
