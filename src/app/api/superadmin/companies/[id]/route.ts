import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { audit, clientIp, requireSuperAdmin } from "@/lib/superadmin/session";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      _count: { select: { users: true, stores: true, products: true } },
      users: { select: { id: true, username: true, fullName: true, phone: true, role: true, isActive: true, createdAt: true }, orderBy: { fullName: "asc" } },
      stores: { select: { id: true, name: true, address: true, kind: true, marque: true, matricule: true, isActive: true, userId: true }, orderBy: { name: "asc" } },
    },
  });
  if (!company) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(company);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const fields = ["name", "phone", "address", "email", "rc", "nif", "ai", "nis", "bankName", "rib"] as const;
  const data: Record<string, string | null> = {};
  for (const field of fields) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== "string") return NextResponse.json({ error: "invalid_field" }, { status: 400 });
    const value = (body[field] as string).trim();
    if (field === "name" && !value) return NextResponse.json({ error: "name_required" }, { status: 400 });
    data[field] = value || null;
  }
  if (!Object.keys(data).length) return NextResponse.json({ error: "no_changes" }, { status: 400 });
  try {
    const company = await prisma.company.update({ where: { id }, data });
    await audit(auth.admin.adminId, "company_updated", "company", id, data, clientIp(req) ?? undefined);
    return NextResponse.json(company);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}