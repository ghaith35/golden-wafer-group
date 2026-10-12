import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { expenseSchema } from "@/lib/cash/validation";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await prisma.expense.findFirst({ where: { id, companyId: session.companyId, deletedAt: null } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = expenseSchema.partial().safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  const d = parsed.data;
  // Staff may only edit their OWN van's rows, and never move them elsewhere.
  if (session.role !== "Admin") {
    const ownVan = await prisma.store.findFirst({
      where: { companyId: session.companyId, kind: "VAN", userId: session.userId },
      select: { id: true },
    });
    if (!ownVan || existing.locationId !== ownVan.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    delete d.locationId;
  }
  if (d.typeId) {
    const t = await prisma.expenseType.findFirst({ where: { id: d.typeId, companyId: session.companyId }, select: { id: true } });
    if (!t) return NextResponse.json({ error: "bad_type" }, { status: 400 });
  }
  if (d.locationId) {
    const l = await prisma.store.findFirst({ where: { id: d.locationId, companyId: session.companyId }, select: { id: true } });
    if (!l) return NextResponse.json({ error: "bad_location" }, { status: 400 });
  }
  const row = await prisma.expense.update({
    where: { id },
    data: {
      ...(d.label !== undefined ? { label: d.label.trim() } : {}),
      ...(d.description !== undefined ? { description: d.description?.trim() || null } : {}),
      ...(d.amount !== undefined ? { amount: d.amount } : {}),
      ...(d.typeId !== undefined ? { typeId: d.typeId } : {}),
      ...(d.locationId !== undefined ? { locationId: d.locationId } : {}),
      ...(d.expenseDate ? { expenseDate: new Date(d.expenseDate) } : {}),
    },
  });
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await prisma.expense.findFirst({ where: { id, companyId: session.companyId, deletedAt: null } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Admin, or staff deleting their OWN van's rows (soft delete — kept for audit).
  if (session.role !== "Admin") {
    const ownVan = await prisma.store.findFirst({
      where: { companyId: session.companyId, kind: "VAN", userId: session.userId },
      select: { id: true },
    });
    if (!ownVan || existing.locationId !== ownVan.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }
  await prisma.expense.update({ where: { id }, data: { deletedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
