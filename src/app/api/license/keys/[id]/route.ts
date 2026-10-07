import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/settings/helpers";
import { requireSuperAdmin } from "@/lib/superadmin/session";
import { isLocalMode } from "@/lib/license/gate";

async function guard() {
  if (isLocalMode()) return null;
  const su = await requireSuperAdmin();
  if (!su.ok) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return null;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const blocked = await guard();
  if (blocked) return blocked;
  const { id } = await params;
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  const existing = await prisma.licenseKey.findFirst({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (action === "revoke") {
    const row = await prisma.licenseKey.update({ where: { id }, data: { revoked: true } });
    return NextResponse.json(row);
  }
  if (action === "unrevoke") {
    const row = await prisma.licenseKey.update({ where: { id }, data: { revoked: false } });
    return NextResponse.json(row);
  }
  if (action === "delete") {
    await prisma.licenseKey.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  }
  if (action === "reset") {
    // Un-consume a pool key: back to unbound, consumer machine to pending.
    const consumer = existing.consumedByMachineId ?? existing.machineId;
    const row = await prisma.$transaction(async (tx) => {
      const r = await tx.licenseKey.update({
        where: { id },
        data: { machineId: null, consumedByMachineId: null, revoked: false },
      });
      if (consumer) {
        await tx.machine.updateMany({
          where: { machineId: consumer, activationKey: existing.humanKey },
          data: { status: "pending", token: null, activationKey: null },
        });
      }
      return r;
    });
    return NextResponse.json(row);
  }
  if (action === "end_trial") {
    const machineId = existing.machineId;
    if (!machineId) return NextResponse.json({ error: "unbound_key" }, { status: 400 });
    await prisma.$transaction([
      prisma.trialIssue.updateMany({ where: { machineId }, data: { end: new Date() } }),
      prisma.machine.updateMany({ where: { machineId }, data: { trialEnd: new Date() } }),
    ]);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "bad_action" }, { status: 400 });
}
