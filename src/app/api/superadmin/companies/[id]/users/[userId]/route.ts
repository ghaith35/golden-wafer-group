import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { audit, clientIp, requireSuperAdmin } from "@/lib/superadmin/session";

const roles = ["Admin", "Vendeur", "Livreur"] as const;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { id: companyId, userId } = await params;
  const existing = await prisma.user.findFirst({ where: { id: userId, companyId }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (body.username !== undefined) {
    if (typeof body.username !== "string" || !body.username.trim()) return NextResponse.json({ error: "invalid_username" }, { status: 400 });
    data.username = body.username.trim();
  }
  if (body.fullName !== undefined) {
    if (typeof body.fullName !== "string" || !body.fullName.trim()) return NextResponse.json({ error: "invalid_name" }, { status: 400 });
    data.fullName = body.fullName.trim();
  }
  if (body.phone !== undefined) data.phone = typeof body.phone === "string" && body.phone.trim() ? body.phone.trim() : null;
  if (body.role !== undefined) {
    if (typeof body.role !== "string" || !roles.includes(body.role as (typeof roles)[number])) return NextResponse.json({ error: "invalid_role" }, { status: 400 });
    data.role = body.role;
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") return NextResponse.json({ error: "invalid_status" }, { status: 400 });
    data.isActive = body.isActive;
  }
  if (body.password !== undefined) {
    if (typeof body.password !== "string" || body.password.length < 8) return NextResponse.json({ error: "weak_password" }, { status: 400 });
    data.passwordHash = await bcrypt.hash(body.password, 10);
    data.passwordView = body.password;
  }
  if (!Object.keys(data).length) return NextResponse.json({ error: "no_changes" }, { status: 400 });
  try {
    const row = await prisma.user.update({
      where: { id: userId }, data,
      select: { id: true, username: true, fullName: true, phone: true, role: true, isActive: true, createdAt: true },
    });
    const meta = { companyId, ...Object.fromEntries(Object.entries(data).filter(([key]) => key !== "passwordHash" && key !== "passwordView")) };
    await audit(auth.admin.adminId, "company_user_updated", "user", userId, meta, clientIp(req) ?? undefined);
    return NextResponse.json(row);
  } catch (error) {
    const code = (error as { code?: string })?.code;
    return NextResponse.json({ error: code === "P2002" ? "duplicate_username" : "update_failed" }, { status: code === "P2002" ? 409 : 400 });
  }
}