import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSuperAdmin, audit, clientIp } from "@/lib/superadmin/session";

/// Pool key actions: revoke | unrevoke | delete | reset (un-consume).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  const existing = await prisma.licenseKey.findFirst({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const ip = clientIp(req) ?? undefined;
  if (action === "revoke") {
    const row = await prisma.licenseKey.update({ where: { id }, data: { revoked: true } });
    await audit(auth.admin.adminId, "key_revoked", "key", id, undefined, ip);
    return NextResponse.json(row);
  }
  if (action === "unrevoke") {
    const row = await prisma.licenseKey.update({ where: { id }, data: { revoked: false } });
    await audit(auth.admin.adminId, "key_unrevoked", "key", id, undefined, ip);
    return NextResponse.json(row);
  }
  if (action === "reset") {
    const consumer = existing.consumedByMachineId ?? existing.machineId;
    const row = await prisma.$transaction(async (tx) => {
      const r = await tx.licenseKey.update({ where: { id }, data: { machineId: null, consumedByMachineId: null, revoked: false } });
      if (consumer) {
        await tx.machine.updateMany({ where: { machineId: consumer, activationKey: existing.humanKey }, data: { status: "pending", token: null, activationKey: null } });
      }
      return r;
    });
    await audit(auth.admin.adminId, "key_reset", "key", id, undefined, ip);
    return NextResponse.json(row);
  }
  return NextResponse.json({ error: "bad_action" }, { status: 400 });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  await prisma.licenseKey.delete({ where: { id } });
  await audit(auth.admin.adminId, "key_deleted", "key", id, undefined, clientIp(req) ?? undefined);
  return NextResponse.json({ ok: true });
}
