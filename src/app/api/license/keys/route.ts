import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/settings/helpers";
import { randomHumanKey, licenseConfigured } from "@/lib/license/sign";

/// Admin console: list machines + keys, mint keys, revoke.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const [machines, keys, trials] = await Promise.all([
    prisma.machine.findMany({ orderBy: { lastSeen: "desc" }, take: 200 }),
    prisma.licenseKey.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.trialIssue.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  return NextResponse.json({ machines, keys, trials, licenseConfigured: licenseConfigured() });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!licenseConfigured()) return NextResponse.json({ error: "license_not_configured" }, { status: 500 });
  const { label, machineId } = (await req.json().catch(() => ({}))) as { label?: string; machineId?: string };
  const row = await prisma.licenseKey.create({
    data: { label: label?.trim() || null, machineId: machineId?.trim() || null, humanKey: randomHumanKey() },
  });
  return NextResponse.json(row, { status: 201 });
}
