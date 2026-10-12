import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { aggregateVanReport } from "@/lib/reports/vanReport";

/// Admin sales-by-van reports (proxy enforces admin-only).
/// - ?report=vans → van buttons [{id, name, matricule}].
/// - ?report=van-detail&van=<id> → summary + products + top for one van.
/// The old debts/margins tabs + CSV export were removed (admin decision).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const report = sp.get("report") ?? "vans";
  const companyId = session.companyId;

  if (report === "vans") {
    const vans = await prisma.store.findMany({
      where: { companyId, kind: "VAN" },
      select: { id: true, name: true, matricule: true },
      orderBy: { name: "asc" },
      take: 200,
    });
    return NextResponse.json(vans.map((v) => ({ id: v.id, name: v.name, matricule: v.matricule ?? "" })));
  }

  if (report === "van-detail") {
    const vanId = sp.get("van") ?? "";
    const van = await prisma.store.findFirst({
      where: { id: vanId, companyId, kind: "VAN" },
      select: { id: true, name: true, matricule: true },
    });
    if (!van) return NextResponse.json({ error: "not_found" }, { status: 404 });
    // Literal tuple (not string[]): the generated client types kind/status
    // as string enums, and a widened object literal would not assign.
    const KINDS = ["DELIVERY", "TICKET"] as ["DELIVERY", "TICKET"];
    const saleWhere = { companyId, kind: { in: KINDS }, status: "DELIVERED" as const, locationId: van.id };
    const [sales, lines, expenses, tournees] = await Promise.all([
      prisma.sale.findMany({ where: saleWhere, select: { total: true, paid: true }, take: 10000 }),
      prisma.saleLine.findMany({
        where: { sale: saleWhere },
        select: { productId: true, baseQty: true, lineTotal: true, unitCost: true, product: { select: { name: true, reference: true } } },
        take: 20000,
      }),
      prisma.expense.findMany({
        where: { companyId, locationId: van.id, deletedAt: null },
        select: { amount: true },
        take: 5000,
      }),
      prisma.tournee.findMany({
        where: { companyId, locationId: van.id },
        select: { startedAt: true, finishedAt: true },
        take: 1000,
      }),
    ]);
    return NextResponse.json({
      van: { id: van.id, name: van.name, matricule: van.matricule ?? "" },
      ...aggregateVanReport({ sales, lines, expenses, tournees }),
    });
  }

  return NextResponse.json({ error: "bad_report" }, { status: 400 });
}
