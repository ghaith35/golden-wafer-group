import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/settings/helpers";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  const existing = await prisma.licenseKey.findFirst({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (action === "revoke") {
    const row = await prisma.licenseKey.update({ where: { id }, data: { revoked: true } });
    return NextResponse.json(row);
  }
  if (action === "unrevoke") {
    const row = await prisma.licenseKey.update({ where: { id }, data: { revoked: false } });
    return NextResponse.json(row);
  }
  if (action === "delete") {
    await prisma.licenseKey.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "bad_action" }, { status: 400 });
}
