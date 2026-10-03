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
  if (session.role !== "Admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const existing = await prisma.expense.findFirst({ where: { id, companyId: session.companyId, deletedAt: null } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await prisma.expense.update({ where: { id }, data: { deletedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
