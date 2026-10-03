import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

/// Main-depot availability per product (for bons de commande, which are
/// prepared from the depot — never the van).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const batches = await prisma.stockBatch.groupBy({
    by: ["productId"],
    where: { companyId: session.companyId, storeId: null, transferId: null },
    _sum: { qty: true },
  });
  const located = await prisma.stockBatch.groupBy({
    by: ["productId"],
    where: { companyId: session.companyId, transferId: null, location: { kind: "DEPOT" } },
    _sum: { qty: true },
  });
  const map = new Map<string, number>();
  for (const b of [...batches, ...located]) {
    map.set(b.productId, (map.get(b.productId) ?? 0) + Number(b._sum.qty ?? 0));
  }
  return NextResponse.json(Object.fromEntries(map));
}
