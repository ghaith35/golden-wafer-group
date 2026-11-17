import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/settings/helpers";
import { userPatchSchema } from "@/lib/users/validation";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const existing = await prisma.user.findFirst({ where: { id, companyId: auth.session.companyId } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (existing.id === auth.session.userId) {
    return NextResponse.json({ error: "cannot_edit_self" }, { status: 400 });
  }
  const raw = await req.json().catch(() => ({}));
  const parsed = userPatchSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  const d = parsed.data;
  // Staff scope can neither touch Admin accounts nor promote to Admin.
  if ((raw as { scope?: string }).scope === "staff" && (existing.role === "Admin" || d.role === "Admin")) {
    return NextResponse.json({ error: "forbidden_role" }, { status: 403 });
  }
  if (d.vanId) {
    const van = await prisma.store.findFirst({ where: { id: d.vanId, companyId: auth.session.companyId, kind: "VAN" } });
    if (!van) return NextResponse.json({ error: "bad_van" }, { status: 400 });
    if ((d.role ?? existing.role) === "Admin") return NextResponse.json({ error: "admin_no_van" }, { status: 400 });
  }
  const row = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        ...(d.fullName !== undefined ? { fullName: d.fullName.trim() } : {}),
        ...(d.phone !== undefined ? { phone: d.phone?.trim() || null } : {}),
        ...(d.password !== undefined ? { passwordHash: await bcrypt.hash(d.password, 10), passwordView: d.password } : {}),
        ...(d.role !== undefined ? { role: d.role } : {}),
        ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      },
    });
    if (d.vanId !== undefined) {
      await tx.store.updateMany({ where: { userId: id }, data: { userId: null } });
      if (d.vanId) await tx.store.update({ where: { id: d.vanId }, data: { userId: id } });
    }
    return tx.user.findFirstOrThrow({
      where: { id },
      select: { id: true, username: true, fullName: true, phone: true, role: true, isActive: true, passwordView: true, qrToken: true, assignedVans: { select: { id: true, name: true } } },
    });
  });
  return NextResponse.json(row);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const existing = await prisma.user.findFirst({ where: { id, companyId: auth.session.companyId } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (existing.id === auth.session.userId) {
    return NextResponse.json({ error: "cannot_edit_self" }, { status: 400 });
  }
  // Admin accounts can only be deleted from Settings → Admins.
  if (new URL(req.url).searchParams.get("scope") === "staff" && existing.role === "Admin") {
    return NextResponse.json({ error: "forbidden_role" }, { status: 403 });
  }
  // Hard delete (sales he created stay, just unlinked; van is unassigned).
  // If anything still references him, fall back to deactivating the account.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.store.updateMany({ where: { userId: id }, data: { userId: null } });
      await tx.user.delete({ where: { id } });
    });
    return NextResponse.json({ ok: true });
  } catch {
    await prisma.$transaction(async (tx) => {
      await tx.store.updateMany({ where: { userId: id }, data: { userId: null } });
      await tx.user.update({ where: { id }, data: { isActive: false } });
    });
    return NextResponse.json({ ok: true, deactivated: true });
  }
}
