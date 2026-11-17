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
  // Re-assigning a van to a DIFFERENT driver: must be company staff, not an
  // Admin, max one van. Keeping the current driver (e.g. legacy Admin
  // assignments) always passes — otherwise those vans become uneditable.
  if (d.userId && d.userId !== existing.userId) {
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
  // Forced delete (after the UI's double confirmation): wipe the location's
  // operational history — stock, transfers, counts, losses, client returns,
  // tours, daily closes. Sales and expenses are accounting records: they are
  // kept and simply unlinked from the location (FK SetNull).
  if (new URL(_req.url).searchParams.get("force") === "1") {
    if (session.role !== "Admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const companyId = session.companyId;
    try {
      await prisma.$transaction(async (tx) => {
      const transferIds = (
        await tx.transfer.findMany({ where: { companyId, OR: [{ fromLocationId: id }, { toLocationId: id }] }, select: { id: true } })
      ).map((t) => t.id);
      await tx.stockBatch.deleteMany({ where: { OR: [{ storeId: id }, ...(transferIds.length ? [{ transferId: { in: transferIds } }] : [])] } });
      await tx.transfer.deleteMany({ where: { id: { in: transferIds } } });
      await tx.stockCount.deleteMany({ where: { companyId, locationId: id } });
      await tx.stockLoss.deleteMany({ where: { companyId, locationId: id } });
      await tx.clientReturn.deleteMany({ where: { companyId, locationId: id } });
      await tx.tournee.deleteMany({ where: { companyId, locationId: id } });
      await tx.store.delete({ where: { id } });
      });
    } catch {
      return NextResponse.json({ error: "delete_failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // Plain delete: only when nothing references it, else tell the UI.
  const archive = async () => {
    await prisma.store.update({ where: { id }, data: { isActive: false, userId: null } });
    return NextResponse.json({ ok: true, deactivated: true });
  };
  const used =
    (await prisma.stockBatch.count({ where: { storeId: id, qty: { gt: 0 } } })) +
    (await prisma.transfer.count({ where: { companyId: session.companyId, OR: [{ fromLocationId: id }, { toLocationId: id }] } })) +
    (await prisma.tournee.count({ where: { companyId: session.companyId, locationId: id } }));
  if (used > 0) return archive();
  try {
    await prisma.store.delete({ where: { id } });
  } catch {
    // Remaining Restrict relations (counts, returns, movements) → archive.
    return archive();
  }
  return NextResponse.json({ ok: true });
}
