import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSuperAdmin, audit, clientIp } from "@/lib/superadmin/session";

/// Deployment actions (vendor only):
/// - set_version {version} — the version sold to the client
/// - set_override {domain} — vendor-side override domain (client self-service
///   uses /api/client-domain with their activation code instead)
/// - toggle_override {active} — choose which domain serves
/// - activate | deactivate — traffic switch (primary domain is never
///   editable and the row is never deletable: deactivate only)
/// - retry — back to pending for the provision worker
/// - link_machine {machineId} — bind the shop PC
/// - link_tunnel {tunnelSlotId} — pair the tunnel/APK side
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const su = await requireSuperAdmin();
  if (!su.ok) return su.response;
  const { id } = await params;
  const row = await prisma.clientDeployment.findFirst({ where: { id } });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");
  const ip = clientIp(req) ?? undefined;
  const str = (v: unknown) => String(v ?? "").trim();

  if (action === "set_override") {
    const domain = str(body.domain).toLowerCase();
    if (domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return NextResponse.json({ error: "bad_domain" }, { status: 400 });
    if (domain && domain === row.domain) return NextResponse.json({ error: "same_as_primary" }, { status: 400 });
    const updated = await prisma.clientDeployment.update({
      where: { id },
      data: { domainOverride: domain || null, overrideActive: domain ? true : false },
    });
    await audit(su.admin.adminId, "deployment_override", "deployment", id, { domain }, ip);
    return NextResponse.json(updated);
  }
  if (action === "toggle_override") {
    if (!row.domainOverride) return NextResponse.json({ error: "no_override" }, { status: 400 });
    const updated = await prisma.clientDeployment.update({
      where: { id },
      data: { overrideActive: !row.overrideActive },
    });
    await audit(su.admin.adminId, "deployment_override_toggle", "deployment", id, { active: updated.overrideActive }, ip);
    return NextResponse.json(updated);
  }
  if (action === "activate" || action === "deactivate") {
    const updated = await prisma.clientDeployment.update({
      where: { id },
      data: { status: action === "activate" ? "active" : "deactivated" },
    });
    await audit(su.admin.adminId, action === "activate" ? "deployment_activated" : "deployment_deactivated", "deployment", id, undefined, ip);
    return NextResponse.json(updated);
  }
  if (action === "retry") {
    const updated = await prisma.clientDeployment.update({
      where: { id },
      data: { status: "pending", lastError: null },
    });
    await audit(su.admin.adminId, "deployment_retry", "deployment", id, undefined, ip);
    return NextResponse.json(updated);
  }
  if (action === "link_machine") {
    const machineId = str(body.machineId);
    const updated = await prisma.clientDeployment.update({
      where: { id },
      data: { machineId: machineId || null },
    });
    await audit(su.admin.adminId, "deployment_link_machine", "deployment", id, { machineId }, ip);
    return NextResponse.json(updated);
  }
  if (action === "link_tunnel") {
    const tunnelSlotId = str(body.tunnelSlotId);
    if (tunnelSlotId) {
      const slot = await prisma.tunnelSlot.findFirst({ where: { id: tunnelSlotId } });
      if (!slot) return NextResponse.json({ error: "bad_slot" }, { status: 400 });
    }
    const updated = await prisma.clientDeployment.update({
      where: { id },
      data: { tunnelSlotId: tunnelSlotId || null },
    });
    await audit(su.admin.adminId, "deployment_link_tunnel", "deployment", id, { tunnelSlotId }, ip);
    return NextResponse.json(updated);
  }
  return NextResponse.json({ error: "bad_action" }, { status: 400 });
}
