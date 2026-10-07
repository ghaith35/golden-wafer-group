import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { audit, clientIp, requireSuperAdmin } from "@/lib/superadmin/session";

const roles = ["Admin", "Vendeur", "Livreur"] as const;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { id: companyId } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const role = typeof body.role === "string" ? body.role : "";
  if (!username || !fullName || password.length < 8 || !roles.includes(role as (typeof roles)[number])) {
    return NextResponse.json({ error: "invalid_user" }, { status: 400 });
  }
  try {
    const row = await prisma.user.create({
      data: {
        companyId, username, fullName, role: role as (typeof roles)[number],
        phone: typeof body.phone === "string" && body.phone.trim() ? body.phone.trim() : null,
        passwordHash: await bcrypt.hash(password, 10), passwordView: password,
        qrToken: crypto.randomBytes(24).toString("hex"),
      },
      select: { id: true, username: true, fullName: true, phone: true, role: true, isActive: true, createdAt: true },
    });
    await audit(auth.admin.adminId, "company_user_created", "user", row.id, { companyId, username, role }, clientIp(req) ?? undefined);
    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    return NextResponse.json({ error: code === "P2002" ? "duplicate_username" : "create_failed" }, { status: code === "P2002" ? 409 : 400 });
  }
}