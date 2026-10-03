import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSuperAdmin, audit, clientIp } from "@/lib/superadmin/session";
import { generateActivationKey, licenseConfigured } from "@/lib/license/sign";

/// Pool keys: list + bulk mint. Consumed/bound keys show their machine.
export async function GET(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const sp = new URL(req.url).searchParams;
  const bound = sp.get("bound");
  const rows = await prisma.licenseKey.findMany({
    where: bound === "free" ? { machineId: null, consumedByMachineId: null, revoked: false } : {},
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  if (!licenseConfigured()) return NextResponse.json({ error: "license_not_configured" }, { status: 500 });
  const { count, label } = (await req.json().catch(() => ({}))) as { count?: number; label?: string };
  const n = Math.min(100, Math.max(1, Math.floor(Number(count) || 1)));
  const rows = await prisma.$transaction(
    Array.from({ length: n }, () =>
      prisma.licenseKey.create({ data: { label: label?.trim() || null, humanKey: generateActivationKey() } })
    )
  );
  await audit(auth.admin.adminId, "keys_minted", "keys", undefined, { count: n, label }, clientIp(req) ?? undefined);
  return NextResponse.json(rows, { status: 201 });
}
