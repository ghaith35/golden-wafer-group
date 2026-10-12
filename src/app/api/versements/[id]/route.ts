import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

/// Delete a cash-collection handover (Admin only). Day aggregates are
/// live-summed from versements, so deleting cleanly reverses the remit —
/// unless the van-day is already CLOSED (reopen it first).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "Admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const v = await prisma.versement.findFirst({ where: { id, companyId: session.companyId } });
  if (!v) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (v.kind !== "CASH_COLLECTION") return NextResponse.json({ error: "bad_kind" }, { status: 400 });
  if (v.locationId && v.date) {
    const close = await prisma.dailyClose.findFirst({
      where: { companyId: session.companyId, vanId: v.locationId, date: v.date },
      select: { status: true },
    });
    if (close?.status === "CLOSED") return NextResponse.json({ error: "already_closed" }, { status: 400 });
  }
  await prisma.versement.delete({ where: { id: v.id } });
  return NextResponse.json({ ok: true });
}
