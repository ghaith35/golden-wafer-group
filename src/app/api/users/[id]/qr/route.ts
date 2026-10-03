import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/settings/helpers";

/// Regenerate a staff member's QR login token (revokes the old QR).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const existing = await prisma.user.findFirst({ where: { id, companyId: auth.session.companyId } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const row = await prisma.user.update({
    where: { id },
    data: { qrToken: crypto.randomBytes(24).toString("hex") },
    select: { id: true, qrToken: true },
  });
  return NextResponse.json(row);
}
