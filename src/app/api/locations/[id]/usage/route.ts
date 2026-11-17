import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

/// What would be lost if this location were deleted (shown before the
/// double-confirmation in the UI).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const companyId = session.companyId;
  const loc = await prisma.store.findFirst({ where: { id, companyId }, select: { id: true } });
  if (!loc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const [stock, transfers, counts, losses, returns, tournees, sales, expenses, closes] = await Promise.all([
    prisma.stockBatch.count({ where: { storeId: id, qty: { gt: 0 } } }),
    prisma.transfer.count({ where: { companyId, OR: [{ fromLocationId: id }, { toLocationId: id }] } }),
    prisma.stockCount.count({ where: { companyId, locationId: id } }),
    prisma.stockLoss.count({ where: { companyId, locationId: id } }),
    prisma.clientReturn.count({ where: { companyId, locationId: id } }),
    prisma.tournee.count({ where: { companyId, locationId: id } }),
    prisma.sale.count({ where: { companyId, locationId: id } }),
    prisma.expense.count({ where: { companyId, locationId: id } }),
    prisma.dailyClose.count({ where: { companyId, vanId: id } }),
  ]);
  return NextResponse.json({ stock, transfers, counts, losses, returns, tournees, closes, sales, expenses });
}
