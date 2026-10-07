import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { audit, clientIp, requireSuperAdmin } from "@/lib/superadmin/session";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; storeId: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { id: companyId, storeId } = await params;
  const existing = await prisma.store.findFirst({ where: { id: storeId, companyId }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, string | boolean | null> = {};
  for (const field of ["name", "address", "marque", "matricule"] as const) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== "string") return NextResponse.json({ error: "invalid_field" }, { status: 400 });
    const value = (body[field] as string).trim();
    if (field === "name" && !value) return NextResponse.json({ error: "invalid_name" }, { status: 400 });
    data[field] = value || null;
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") return NextResponse.json({ error: "invalid_status" }, { status: 400 });
    data.isActive = body.isActive;
  }
  if (!Object.keys(data).length) return NextResponse.json({ error: "no_changes" }, { status: 400 });
  const row = await prisma.store.update({ where: { id: storeId }, data, select: { id: true, name: true, address: true, kind: true, marque: true, matricule: true, isActive: true, userId: true } });
  await audit(auth.admin.adminId, "company_store_updated", "store", storeId, { companyId, ...data }, clientIp(req) ?? undefined);
  return NextResponse.json(row);
}