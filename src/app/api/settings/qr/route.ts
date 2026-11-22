import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/settings/helpers";

/// Per-van QR rules: scan the client QR to sell / to create an order.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const vans = await prisma.store.findMany({
    where: { companyId: auth.session.companyId, kind: "VAN", isActive: true },
    select: {
      id: true,
      name: true,
      matricule: true,
      qrSellRequired: true,
      qrOrderRequired: true,
      user: { select: { fullName: true } },
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(vans);
}

const patchSchema = z.object({
  vanId: z.string().min(1).optional(),
  all: z.boolean().optional(),
  qrSellRequired: z.boolean().optional(),
  qrOrderRequired: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  const d = parsed.success ? parsed.data : null;
  if (!d || (!d.vanId && !d.all) || (d.qrSellRequired === undefined && d.qrOrderRequired === undefined)) {
    return NextResponse.json({ error: "validation_error" }, { status: 400 });
  }
  const { count } = await prisma.store.updateMany({
    where: { companyId: auth.session.companyId, kind: "VAN", ...(d.all ? {} : { id: d.vanId }) },
    data: {
      ...(d.qrSellRequired !== undefined ? { qrSellRequired: d.qrSellRequired } : {}),
      ...(d.qrOrderRequired !== undefined ? { qrOrderRequired: d.qrOrderRequired } : {}),
    },
  });
  if (!count) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
