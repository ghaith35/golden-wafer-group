import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { activationToken, licenseConfigured } from "@/lib/license/sign";

/// Redeem a human key (DILI-XXXX-XXXX-XXXX). Pool keys bind first-device-wins.
export async function POST(req: Request) {
  if (!licenseConfigured()) return NextResponse.json({ error: "license_not_configured" }, { status: 500 });
  const { machineId, key, label } = (await req.json().catch(() => ({}))) as {
    machineId?: string;
    key?: string;
    label?: string;
  };
  if (!machineId || !key) return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  const record = await prisma.licenseKey.findUnique({ where: { humanKey: key.trim().toUpperCase() } });
  if (!record || record.revoked) return NextResponse.json({ error: "invalid_key" }, { status: 400 });
  if (record.machineId && record.machineId !== machineId) {
    return NextResponse.json({ error: "already_bound" }, { status: 400 });
  }
  const updated = await prisma.licenseKey.update({
    where: { id: record.id },
    data: { machineId, label: label || record.label },
  });
  await prisma.machine.upsert({
    where: { machineId },
    update: { lastSeen: new Date() },
    create: { machineId, label: label ?? null },
  });
  return NextResponse.json({ token: activationToken(machineId, updated.label ?? "", updated.humanKey) });
}
