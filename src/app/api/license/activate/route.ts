import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { activationToken, licenseConfigured } from "@/lib/license/sign";

/// Polled by activated installs: returns a FRESHLY signed token while entitled.
/// Always re-signs with the current key (never serves the stored machine.token,
/// which may have been signed with a rotated/ALT key the installer rejects).
/// Manually activated machines (status=activated, no LicenseKey row — e.g.
/// superadmin console activate) are served too: the desktop license-check
/// polls this endpoint, not /status.
export async function POST(req: Request) {
  if (!licenseConfigured()) return NextResponse.json({});
  const { machineId } = (await req.json().catch(() => ({}))) as { machineId?: string };
  if (!machineId || typeof machineId !== "string") return NextResponse.json({});
  const key = await prisma.licenseKey.findFirst({ where: { machineId, revoked: false } });
  if (key) {
    await prisma.machine.updateMany({ where: { machineId }, data: { lastSeen: new Date() } });
    return NextResponse.json({ token: activationToken(machineId, key.label ?? "", key.humanKey) });
  }
  const machine = await prisma.machine.findUnique({ where: { machineId } });
  if (machine?.status === "activated") {
    await prisma.machine.updateMany({ where: { machineId }, data: { lastSeen: new Date() } });
    return NextResponse.json({
      token: activationToken(machineId, machine.label ?? "", machine.activationKey ?? undefined),
    });
  }
  return NextResponse.json({});
}
