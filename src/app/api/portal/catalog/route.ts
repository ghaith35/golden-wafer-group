import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPortalSession } from "@/lib/portal/session";

/// Client-tier-priced catalog with gallery + availability (no quantities).
export async function GET() {
  const session = await getPortalSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const client = await prisma.customer.findFirst({
    where: { id: session.clientId, companyId: session.companyId },
    include: { tier: true },
  });
  if (!client) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const products = await prisma.product.findMany({
    where: { companyId: session.companyId, isActive: true },
    include: {
      images: { orderBy: { sortOrder: "asc" } },
      tierPrices: { where: client.tierId ? { tierId: client.tierId } : undefined },
      conversions: { include: { unit: true } },
      baseUnit: true,
    },
    orderBy: { name: "asc" },
    take: 500,
  });

  return NextResponse.json({
    client: { name: client.name, code: client.code, tier: client.tier?.name ?? null },
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      reference: p.reference,
      price: p.tierPrices[0] ? Number(p.tierPrices[0].price) : Number(p.salePrice),
      images: p.images.map((i) => i.url),
      units: [
        ...(p.baseUnit ? [{ id: p.baseUnit.id, name: p.baseUnit.name, factor: 1 }] : []),
        ...p.conversions.map((c) => ({ id: c.unitId, name: c.unit.name, factor: Number(c.factor) })),
      ],
      inStock: Number(p.stockQty) > 0,
    })),
  });
}
