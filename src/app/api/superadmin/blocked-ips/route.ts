import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSuperAdmin, audit, clientIp } from "@/lib/superadmin/session";

/// Manual IP blocks (register/trial gate only — never breaks entitlement).
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  return NextResponse.json(await prisma.blockedIp.findMany({ orderBy: { createdAt: "desc" }, take: 200 }));
}

export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { ip, reason } = (await req.json().catch(() => ({}))) as { ip?: string; reason?: string };
  if (!ip || typeof ip !== "string") return NextResponse.json({ error: "bad_ip" }, { status: 400 });
  const row = await prisma.blockedIp.upsert({
    where: { ip: ip.trim() },
    create: { ip: ip.trim(), reason: reason?.trim() || null },
    update: { reason: reason?.trim() || null },
  });
  await audit(auth.admin.adminId, "ip_blocked", "ip", ip.trim(), { reason }, clientIp(req) ?? undefined);
  return NextResponse.json(row, { status: 201 });
}

export async function DELETE(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const ip = new URL(req.url).searchParams.get("ip");
  if (!ip) return NextResponse.json({ error: "bad_ip" }, { status: 400 });
  await prisma.blockedIp.deleteMany({ where: { ip } });
  await audit(auth.admin.adminId, "ip_unblocked", "ip", ip, undefined, clientIp(req) ?? undefined);
  return NextResponse.json({ ok: true });
}
