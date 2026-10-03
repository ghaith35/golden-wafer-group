import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { supplierPatchSchema } from "@/lib/clients/validation";
import { nextDocNumber } from "@/lib/docs/sequences";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const row = await prisma.supplier.findFirst({
    where: { id: (await params).id, companyId: session.companyId },
    include: {
      wilaya: true,
      secteur: true,
      defaultProducts: { select: { id: true, name: true }, take: 50 },
      purchaseInvoices: { orderBy: { date: "desc" }, take: 20, select: { id: true, number: true, date: true, total: true } },
      supplierReturns: { orderBy: { date: "desc" }, take: 20, select: { id: true, number: true, date: true, total: true } },
    },
  });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await prisma.supplier.findFirst({ where: { id, companyId: session.companyId } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = supplierPatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  const d = parsed.data;
  const data: Record<string, unknown> = {
    ...(d.name !== undefined ? { name: d.name.trim() } : {}),
    ...(d.phone !== undefined ? { phone: d.phone?.trim() || null } : {}),
    ...(d.address !== undefined ? { address: d.address?.trim() || null } : {}),
    ...(d.wilayaCode !== undefined ? { wilayaCode: d.wilayaCode } : {}),
    ...(d.secteurId !== undefined ? { secteurId: d.secteurId } : {}),
    ...(d.notes !== undefined ? { notes: d.notes?.trim() || null } : {}),
    ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
  };
  if (!existing.code) {
    const code = await prisma.$transaction((tx) => nextDocNumber(tx, session.companyId, "supplier", 0, "SUP"));
    data.code = code;
  }
  const row = await prisma.supplier.update({ where: { id }, data });
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await prisma.supplier.findFirst({ where: { id, companyId: session.companyId } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const invoices = await prisma.purchaseInvoice.count({ where: { supplierId: id } });
  if (Number(existing.balance) !== 0 || invoices > 0) {
    await prisma.supplier.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({ ok: true, deactivated: true });
  }
  await prisma.supplier.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
