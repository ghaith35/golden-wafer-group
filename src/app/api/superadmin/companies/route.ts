import { NextResponse } from "next/server";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireSuperAdmin, audit, clientIp } from "@/lib/superadmin/session";

/// Client companies: list + provision (company + settings + admin user).
export async function GET(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim();
  const rows = await prisma.company.findMany({
    where: q ? { name: { contains: q } } : {},
    include: { _count: { select: { users: true, stores: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { name, phone, adminUsername, adminPassword, adminName } = (await req.json().catch(() => ({}))) as {
    name?: string;
    phone?: string;
    adminUsername?: string;
    adminPassword?: string;
    adminName?: string;
  };
  if (!name?.trim() || !adminUsername?.trim() || !adminPassword || adminPassword.length < 8) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  const company = await prisma.$transaction(async (tx) => {
    const c = await tx.company.create({
      data: { name: name.trim(), phone: phone?.trim() || null },
    });
    // Single in-tx upsert (a second connection would deadlock on this row).
    await tx.companySettings.upsert({
      where: { companyId: c.id },
      update: {},
      create: { companyId: c.id },
    });
    await tx.user.create({
      data: {
        companyId: c.id,
        username: adminUsername.trim(),
        passwordHash: await bcrypt.hash(adminPassword, 10),
        passwordView: adminPassword,
        fullName: adminName?.trim() || adminUsername.trim(),
        role: "Admin",
        qrToken: crypto.randomBytes(24).toString("hex"),
      },
    });
    return c;
  });
  await audit(auth.admin.adminId, "company_created", "company", company.id, { name }, clientIp(req) ?? undefined);
  return NextResponse.json(company, { status: 201 });
}
