import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/settings/helpers";
import { requireSuperAdmin } from "@/lib/superadmin/session";
import { isLocalMode } from "@/lib/license/gate";
import { generateActivationKey, licenseConfigured } from "@/lib/license/sign";

/// License console: the machine/key pool is GLOBAL (vendor-level), so on a
/// central multi-tenant install only a superadmin may touch it. On a local
/// (single-business, self-hosted) install the company admin owns the machine,
/// so requireAdmin is enough.
async function guard() {
  if (isLocalMode()) return null;
  const su = await requireSuperAdmin();
  if (!su.ok) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return null;
}

/// Admin console: list machines + keys, mint keys, revoke.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const blocked = await guard();
  if (blocked) return blocked;
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
  const blocked = await guard();
  if (blocked) return blocked;
  if (!licenseConfigured()) return NextResponse.json({ error: "license_not_configured" }, { status: 500 });
  const { label, machineId } = (await req.json().catch(() => ({}))) as { label?: string; machineId?: string };
  const row = await prisma.licenseKey.create({
    data: { label: label?.trim() || null, machineId: machineId?.trim() || null, humanKey: generateActivationKey() },
  });
  return NextResponse.json(row, { status: 201 });
}
