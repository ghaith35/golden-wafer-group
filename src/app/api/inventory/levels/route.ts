import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

/// Live stock levels per location (holding batches excluded).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const locationId = new URL(req.url).searchParams.get("locationId");
  const batches = await prisma.stockBatch.groupBy({
    by: ["productId", "storeId"],
    where: {
      companyId: session.companyId,
      transferId: null,
      qty: { gt: 0 },
      ...(locationId ? { storeId: locationId } : {}),
    },
    _sum: { qty: true },
  });
  const productIds = [...new Set(batches.map((b) => b.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true, name: true, reference: true, minStock: true, stockQty: true,
      baseUnit: { select: { name: true } },
      conversions: { select: { unitId: true, factor: true, unit: { select: { name: true } } } },
    },
  });
  const locations = await prisma.store.findMany({ where: { companyId: session.companyId } });
  return NextResponse.json({
    levels: batches.map((b) => ({ productId: b.productId, locationId: b.storeId, qty: Number(b._sum.qty ?? 0) })),
    products,
    locations,
  });
}
