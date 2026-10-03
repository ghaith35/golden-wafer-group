import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { locationSchema } from "@/lib/inventory/validation";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await prisma.store.findFirst({ where: { id, companyId: session.companyId } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = locationSchema.partial().safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  const d = parsed.data;
  if (d.userId) {
    const u = await prisma.user.findFirst({ where: { id: d.userId, companyId: session.companyId } });
    if (!u || u.role === "Admin") return NextResponse.json({ error: "bad_user" }, { status: 400 });
    // One driver ↔ max one van (excluding this van).
    const busy = await prisma.store.findFirst({
      where: { companyId: session.companyId, userId: d.userId, id: { not: id } },
      select: { name: true },
    });
    if (busy) return NextResponse.json({ error: "driver_busy", van: busy.name }, { status: 409 });
  }
  let row;
  try {
    row = await prisma.store.update({
      where: { id },
      data: {
        ...(d.name !== undefined ? { name: d.name.trim() } : {}),
        ...(d.address !== undefined ? { address: d.address?.trim() || null } : {}),
        ...(d.marque !== undefined ? { marque: d.marque?.trim() || null } : {}),
        ...(d.matricule !== undefined ? { matricule: d.matricule?.trim() || null } : {}),
        ...(d.imageUrl !== undefined ? { imageUrl: d.imageUrl?.trim() || null } : {}),
        ...(d.userId !== undefined ? { userId: d.userId } : {}),
        ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      },
    });
  } catch (e) {
    if (String(e).includes("stores_companyId_userId_key")) {
      return NextResponse.json({ error: "driver_busy" }, { status: 409 });
    }
    throw e;
  }
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await prisma.store.findFirst({ where: { id, companyId: session.companyId } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const used =
    (await prisma.stockBatch.count({ where: { storeId: id, qty: { gt: 0 } } })) +
    (await prisma.transfer.count({ where: { companyId: session.companyId, OR: [{ fromLocationId: id }, { toLocationId: id }] } }));
  if (used > 0) {
    await prisma.store.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({ ok: true, deactivated: true });
  }
  await prisma.store.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
