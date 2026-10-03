import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPortalSession } from "@/lib/portal/session";
import { createOrder } from "@/lib/sales/service";
import { z } from "zod";

const portalOrderSchema = z.object({
  notes: z.string().max(500).nullish(),
  lines: z
    .array(
      z.object({
        productId: z.string(),
        unitId: z.string().nullish(),
        qty: z.coerce.number().finite().positive(),
      })
    )
    .min(1)
    .max(100),
});

export async function GET() {
  const session = await getPortalSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await prisma.sale.findMany({
    where: { companyId: session.companyId, clientId: session.clientId, kind: "ORDER" },
    include: { lines: { include: { product: { select: { id: true, name: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json(rows);
}

/// Client places a draft order at their tier prices — staff validates.
export async function POST(req: Request) {
  const session = await getPortalSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = portalOrderSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  try {
    const row = await createOrder(
      session.companyId,
      {
        clientId: session.clientId,
        tierId: null,
        remise: 0,
        paid: 0,
        notes: parsed.data.notes ?? null,
        tourneeId: null,
        lines: parsed.data.lines.map((l) => ({ productId: l.productId, unitId: l.unitId ?? null, qty: l.qty, unitPrice: null, remise: 0 })),
      },
      { portal: true }
    );
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
