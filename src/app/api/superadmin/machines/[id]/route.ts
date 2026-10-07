import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSuperAdmin, audit, clientIp } from "@/lib/superadmin/session";
import { activationToken, generateActivationKey, licenseConfigured } from "@/lib/license/sign";

/// Machine actions: activate | unrevoke | revoke | end_trial | reset | edit | delete.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  if (!licenseConfigured()) return NextResponse.json({ error: "license_not_configured" }, { status: 500 });
  const { id } = await params;
  const { action, label, plan, expiresAt, workshop, contactName, phone, email, city } = (await req.json().catch(() => ({}))) as {
    action?: string;
    label?: string;
    plan?: string;
    expiresAt?: string;
    workshop?: string;
    contactName?: string;
    phone?: string;
    email?: string;
    city?: string;
  };
  const machine = await prisma.machine.findFirst({ where: { machineId: id } });
  if (!machine) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const ip = clientIp(req) ?? undefined;

  if (action === "activate" || action === "unrevoke") {
    const key = machine.activationKey ?? generateActivationKey();
    const token = activationToken(machine.machineId, label ?? machine.label ?? "", key);
    const row = await prisma.$transaction([
      prisma.machine.update({
        where: { machineId: id },
        data: { status: "activated", token, activationKey: key, activationType: "machine", activatedAt: new Date(), label: label ?? undefined, lastSeen: new Date() },
      }),
      prisma.machineSubscription.upsert({
        where: { machineId: id },
        create: { machineId: id, plan: plan ?? "standard", status: "active", activatedBy: auth.admin.username },
        update: { status: "active", ...(plan ? { plan } : {}), ...(expiresAt ? { expiresAt: new Date(expiresAt) } : {}) },
      }),
    ]);
    await audit(auth.admin.adminId, action === "activate" ? "machine_activated" : "machine_unrevoked", "machine", id, { label }, ip);
    return NextResponse.json({ ...row[0], token });
  }
  if (action === "revoke") {
    // THE LOCK: status + NULL token. The client wipes .lic files, writes the
    // sticky flag, and lands on /activate on its next poll.
    await prisma.$transaction([
      prisma.machine.update({ where: { machineId: id }, data: { status: "revoked", token: null } }),
      prisma.licenseKey.updateMany({ where: { machineId: id }, data: { revoked: true } }),
      prisma.machineSubscription.updateMany({ where: { machineId: id }, data: { status: "suspended" } }),
    ]);
    await audit(auth.admin.adminId, "machine_revoked", "machine", id, undefined, ip);
    return NextResponse.json({ ok: true });
  }
  if (action === "end_trial") {
    await prisma.$transaction([
      prisma.trialIssue.updateMany({ where: { machineId: id }, data: { end: new Date() } }),
      prisma.machine.updateMany({ where: { machineId: id }, data: { trialEnd: new Date() } }),
    ]);
    await audit(auth.admin.adminId, "trial_ended", "machine", id, undefined, ip);
    return NextResponse.json({ ok: true });
  }
  if (action === "reset") {
    // Back to pending (un-consume pool key if this machine holds one).
    const keys = await prisma.licenseKey.findMany({ where: { OR: [{ machineId: id }, { consumedByMachineId: id }] } });
    await prisma.$transaction([
      prisma.machine.update({ where: { machineId: id }, data: { status: "pending", token: null, activationKey: null } }),
      ...keys.map((k) => prisma.licenseKey.update({ where: { id: k.id }, data: { machineId: null, consumedByMachineId: null, revoked: false } })),
      prisma.machineSubscription.updateMany({ where: { machineId: id }, data: { status: "trial" } }),
    ]);
    await audit(auth.admin.adminId, "machine_reset", "machine", id, undefined, ip);
    return NextResponse.json({ ok: true });
  }
  if (action === "edit") {
    const data: Record<string, string | null> = {};
    if (label !== undefined) data.label = label.trim() || null;
    if (workshop !== undefined) data.workshop = workshop.trim() || null;
    if (contactName !== undefined) data.contactName = contactName.trim() || null;
    if (phone !== undefined) data.phone = phone.trim() || null;
    if (email !== undefined) data.email = email.trim().toLowerCase() || null;
    if (city !== undefined) data.city = city.trim() || null;
    if (Object.keys(data).length === 0 && !plan && !expiresAt) {
      return NextResponse.json({ error: "bad_action" }, { status: 400 });
    }
    const row = await prisma.machine.update({
      where: { machineId: id },
      data,
    });
    await prisma.machineSubscription.upsert({
      where: { machineId: id },
      create: { machineId: id, plan: plan ?? "standard", status: "trial" },
      update: { ...(plan ? { plan } : {}), ...(expiresAt ? { expiresAt: new Date(expiresAt) } : {}) },
    });
    await audit(auth.admin.adminId, "machine_edited", "machine", id, { label, workshop, contactName, phone, email, city, plan }, ip);
    return NextResponse.json(row);
  }
  return NextResponse.json({ error: "bad_action" }, { status: 400 });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  await prisma.machine.deleteMany({ where: { machineId: id } });
  await audit(auth.admin.adminId, "machine_deleted", "machine", id, undefined, clientIp(req) ?? undefined);
  return NextResponse.json({ ok: true });
}
