import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { purchaseSchema } from "@/lib/products/validation";
import { createPurchase } from "@/lib/purchases/service";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const supplierId = searchParams.get("supplierId");
  const rows = await prisma.purchaseInvoice.findMany({
    where: { companyId: session.companyId, ...(supplierId ? { supplierId } : {}) },
    include: { supplier: true, _count: { select: { lines: true } } },
    orderBy: { date: "desc" },
    take: 200,
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = purchaseSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  try {
    const row = await createPurchase(session.companyId, parsed.data);
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
