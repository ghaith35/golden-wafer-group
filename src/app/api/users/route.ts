import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/settings/helpers";
import { userSchema } from "@/lib/users/validation";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const rows = await prisma.user.findMany({
    where: { companyId: auth.session.companyId },
    select: {
      id: true, username: true, fullName: true, phone: true, role: true, isActive: true, createdAt: true,
      passwordView: true, qrToken: true,
      assignedVans: { select: { id: true, name: true, matricule: true } },
    },
    orderBy: { fullName: "asc" },
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const raw = await req.json().catch(() => ({}));
  const parsed = userSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  const d = parsed.data;
  // Staff scope (Livreur / Pré-vendeur page) can never create Admins —
  // Admin accounts are managed exclusively in Settings → Admins.
  if ((raw as { scope?: string }).scope === "staff" && d.role === "Admin") {
    return NextResponse.json({ error: "forbidden_role" }, { status: 403 });
  }
  if (d.vanId) {
    const van = await prisma.store.findFirst({ where: { id: d.vanId, companyId: auth.session.companyId, kind: "VAN" } });
    if (!van) return NextResponse.json({ error: "bad_van" }, { status: 400 });
  }
  try {
    const row = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          companyId: auth.session.companyId,
          username: d.username.trim(),
          passwordHash: await bcrypt.hash(d.password, 10),
          passwordView: d.password,
          phone: d.phone?.trim() || null,
          qrToken: crypto.randomBytes(24).toString("hex"),
          fullName: d.fullName.trim(),
          role: d.role,
          isActive: d.isActive ?? true,
        },
      });
      if (d.vanId) {
        await tx.store.update({ where: { id: d.vanId }, data: { userId: user.id } });
      }
      return tx.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { id: true, username: true, fullName: true, phone: true, role: true, isActive: true, passwordView: true, qrToken: true, assignedVans: { select: { id: true, name: true } } },
      });
    });
    return NextResponse.json(row, { status: 201 });
  } catch {
    return NextResponse.json({ error: "duplicate_username" }, { status: 409 });
  }
}
