import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { activationToken, licenseConfigured } from "@/lib/license/sign";

/// Polled by activated installs: returns the signed token while entitled.
export async function POST(req: Request) {
  if (!licenseConfigured()) return NextResponse.json({});
  const { machineId } = (await req.json().catch(() => ({}))) as { machineId?: string };
  if (!machineId || typeof machineId !== "string") return NextResponse.json({});
  const key = await prisma.licenseKey.findFirst({ where: { machineId, revoked: false } });
  if (!key) return NextResponse.json({});
  await prisma.machine.updateMany({ where: { machineId }, data: { lastSeen: new Date() } });
  return NextResponse.json({ token: activationToken(machineId, key.label ?? "", key.humanKey) });
}
