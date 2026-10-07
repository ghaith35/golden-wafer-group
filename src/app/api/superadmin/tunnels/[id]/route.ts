import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSuperAdmin, audit } from "@/lib/superadmin/session";
import { revokeTunnel } from "@/lib/tunnels/cloudflare";

/// Revoke a tunnel slot: best-effort Cloudflare cleanup (DNS + tunnel),
/// then mark revoked. The client's LAN/offline keeps working regardless.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const su = await requireSuperAdmin();
  if (!su.ok) return su.response;
  const { id } = await params;
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  if (action !== "revoke") return NextResponse.json({ error: "bad_action" }, { status: 400 });
  const slot = await prisma.tunnelSlot.findUnique({ where: { id } });
  if (!slot) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await revokeTunnel(slot.domain, slot.tunnelId);
  const row = await prisma.tunnelSlot.update({ where: { id }, data: { status: "revoked", token: null } });
  await audit(su.admin.adminId, "tunnel.revoke", "tunnel", id, { subdomain: slot.subdomain });
  return NextResponse.json(row);
}
