import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { orderSchema } from "@/lib/sales/validation";
import { createOrder } from "@/lib/sales/service";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const kind = sp.get("kind");
  const status = sp.get("status");
  const rows = await prisma.sale.findMany({
    where: {
      companyId: session.companyId,
      ...(kind ? { kind: kind as never } : {}),
      ...(status ? { status: status as never } : {}),
    },
    include: { client: { select: { id: true, name: true, code: true } }, location: { select: { id: true, name: true } }, _count: { select: { lines: true } } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = orderSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  try {
    const row = await createOrder(session.companyId, parsed.data, { createdBy: session.userId });
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
