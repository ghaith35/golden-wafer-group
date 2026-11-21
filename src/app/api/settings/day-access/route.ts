import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/settings/helpers";

const STAFF = ["Livreur", "Vendeur"] as const;

/// Livreur / Vendeur list with their "may choose the day" flag.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const users = await prisma.user.findMany({
    where: { companyId: auth.session.companyId, isActive: true, role: { in: [...STAFF] } },
    select: { id: true, fullName: true, username: true, role: true, canChooseDay: true },
    orderBy: [{ role: "asc" }, { fullName: "asc" }],
  });
  return NextResponse.json(users);
}

const patchSchema = z.object({ userId: z.string().min(1), canChooseDay: z.boolean() });

export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error" }, { status: 400 });
  const { count } = await prisma.user.updateMany({
    where: { id: parsed.data.userId, companyId: auth.session.companyId, role: { in: [...STAFF] } },
    data: { canChooseDay: parsed.data.canChooseDay },
  });
  if (!count) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
