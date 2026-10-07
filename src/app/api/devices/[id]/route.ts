import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/settings/helpers";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const row = await prisma.device.findFirst({
    where: { id: (await params).id, companyId: auth.session.companyId },
    include: {
      location: true,
      user: { select: { id: true, fullName: true, username: true } },
      ops: { orderBy: { createdAt: "desc" }, take: 100 },
    },
  });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const existing = await prisma.device.findFirst({ where: { id, companyId: auth.session.companyId } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { label?: string; isActive?: boolean; locationId?: string | null };
  if (body.locationId != null) {
    const loc = await prisma.store.findFirst({ where: { id: body.locationId, companyId: auth.session.companyId }, select: { id: true } });
    if (!loc) return NextResponse.json({ error: "bad_location" }, { status: 400 });
  }
  const row = await prisma.device.update({
    where: { id },
    data: {
      ...(typeof body.label === "string" ? { label: body.label.trim() } : {}),
      ...(typeof body.isActive === "boolean" ? { isActive: body.isActive } : {}),
      ...(body.locationId !== undefined ? { locationId: body.locationId } : {}),
    },
  });
  return NextResponse.json(row);
}

/// Retry a failed op: clears it so the device can push it again.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { action, opId } = (await req.json().catch(() => ({}))) as { action?: string; opId?: string };
  if (action === "retry-op" && opId) {
    const op = await prisma.syncOp.findFirst({
      where: { companyId: auth.session.companyId, deviceId: id, opId, status: "FAILED" },
    });
    if (!op) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await prisma.syncOp.delete({ where: { id: op.id } });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "bad_action" }, { status: 400 });
}
