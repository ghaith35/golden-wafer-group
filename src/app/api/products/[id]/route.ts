import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { productSchema } from "@/lib/products/validation";

async function scoped(id: string, companyId: string) {
  return prisma.product.findFirst({
    where: { id, companyId },
    include: {
      images: { orderBy: { sortOrder: "asc" } },
      conversions: { include: { unit: true } },
      tierPrices: { include: { tier: true } },
      category: true,
      baseUnit: true,
      saleUnit: true,
      purchaseUnit: true,
      supplier: true,
    },
  });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const row = await scoped(id, session.companyId);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Grossiste stock card: live qty + CUMP (weighted avg cost) + stock value.
  const batches = await prisma.stockBatch.findMany({
    where: { companyId: session.companyId, productId: id, transferId: null, qty: { gt: 0 } },
    select: { qty: true, unitCost: true, storeId: true },
  });
  let qty = 0;
  let cost = 0;
  for (const b of batches) {
    const q = Number(b.qty);
    qty += q;
    cost += q * Number(b.unitCost);
  }
  const cump = qty > 0 ? cost / qty : 0;
  return NextResponse.json({ ...row, stock: { qty, cump, value: qty * cump } });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await prisma.product.findFirst({ where: { id, companyId: session.companyId } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = productSchema.partial().safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  const d = parsed.data;

  // Default sale/purchase units must be the base unit or one of the conversions.
  if (d.saleUnitId !== undefined || d.purchaseUnitId !== undefined || d.conversions !== undefined || d.baseUnitId !== undefined) {
    const convs = d.conversions ?? await prisma.productUnitConversion.findMany({ where: { productId: id } });
    const baseId = d.baseUnitId !== undefined ? d.baseUnitId : existing.baseUnitId;
    const allowed = new Set([...(baseId ? [baseId] : []), ...convs.map((c) => c.unitId)]);
    for (const key of ["saleUnitId", "purchaseUnitId"] as const) {
      const v = d[key];
      if (v !== undefined && v !== null && !allowed.has(v)) {
        return NextResponse.json({ error: "bad_unit" }, { status: 400 });
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id },
      data: {
        ...(d.name !== undefined ? { name: d.name.trim() } : {}),
        ...(d.reference !== undefined ? { reference: d.reference?.trim() || null } : {}),
        ...(d.barcode !== undefined ? { barcode: d.barcode?.trim() || null } : {}),
        ...(d.colisage !== undefined ? { colisage: d.colisage?.trim() || null } : {}),
        ...(d.categoryId !== undefined ? { categoryId: d.categoryId } : {}),
        ...(d.supplierId !== undefined ? { supplierId: d.supplierId } : {}),
        ...(d.baseUnitId !== undefined ? { baseUnitId: d.baseUnitId } : {}),
        ...(d.saleUnitId !== undefined ? { saleUnitId: d.saleUnitId } : {}),
        ...(d.purchaseUnitId !== undefined ? { purchaseUnitId: d.purchaseUnitId } : {}),
        ...(d.minStock !== undefined ? { minStock: d.minStock } : {}),
        ...(d.salePrice !== undefined ? { salePrice: d.salePrice } : {}),
        ...(d.costPrice !== undefined ? { costPrice: d.costPrice } : {}),
        ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      },
    });
    if (d.images !== undefined) {
      await tx.productImage.deleteMany({ where: { productId: id } });
      if (d.images.length) {
        await tx.productImage.createMany({ data: d.images.map((url, i) => ({ productId: id, url, sortOrder: i })) });
      }
    }
    if (d.conversions !== undefined) {
      await tx.productUnitConversion.deleteMany({ where: { productId: id } });
      if (d.conversions.length) {
        await tx.productUnitConversion.createMany({
          data: d.conversions.map((c) => ({ productId: id, unitId: c.unitId, factor: c.factor, barcode: c.barcode?.trim() || null })),
        });
      }
    }
    if (d.tierPrices !== undefined) {
      await tx.productTierPrice.deleteMany({ where: { productId: id } });
      if (d.tierPrices.length) {
        await tx.productTierPrice.createMany({
          data: d.tierPrices.map((t) => ({ productId: id, tierId: t.tierId, price: t.price })),
        });
      }
    }
  });

  return NextResponse.json(await scoped(id, session.companyId));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await prisma.product.findFirst({ where: { id, companyId: session.companyId } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const movements =
    (await prisma.purchaseLine.count({ where: { productId: id } })) +
    (await prisma.supplierReturnLine.count({ where: { productId: id } }));
  if (movements > 0 || Number(existing.stockQty) !== 0) {
    await prisma.product.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({ ok: true, deactivated: true });
  }
  await prisma.product.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
