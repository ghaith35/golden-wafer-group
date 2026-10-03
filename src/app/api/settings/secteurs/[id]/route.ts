import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/settings/helpers";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { name?: string; isActive?: boolean };
  const existing = await prisma.secteur.findFirst({ where: { id, companyId: auth.session.companyId } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const row = await prisma.secteur.update({
    where: { id },
    data: {
      ...(typeof body.name === "string" ? { name: body.name.trim() } : {}),
      ...(typeof body.isActive === "boolean" ? { isActive: body.isActive } : {}),
    },
  });
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const existing = await prisma.secteur.findFirst({ where: { id, companyId: auth.session.companyId } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await prisma.secteur.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
