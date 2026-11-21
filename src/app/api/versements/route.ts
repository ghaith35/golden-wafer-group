import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { versementSchema } from "@/lib/cash/validation";
import { ensureSeasonFor } from "@/lib/docs/sequences";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const kind = sp.get("kind");
  const clientId = sp.get("clientId");
  const supplierId = sp.get("supplierId");
  const rows = await prisma.versement.findMany({
    where: {
      companyId: session.companyId,
      ...(kind ? { kind: kind as never } : {}),
      ...(clientId ? { clientId } : {}),
      ...(supplierId ? { supplierId } : {}),
    },
    include: {
      client: { select: { id: true, name: true, code: true, gpsLat: true, gpsLng: true } },
      supplier: { select: { id: true, name: true } },
      transfer: { select: { id: true, number: true } },
    },
    orderBy: { date: "desc" },
    take: 300,
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = versementSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  const d = parsed.data;
  if (d.kind === "CLIENT_PAYMENT" && !d.clientId) return NextResponse.json({ error: "client_required" }, { status: 400 });
  if (d.kind === "SUPPLIER_PAYMENT" && !d.supplierId) return NextResponse.json({ error: "supplier_required" }, { status: 400 });

  const date = d.date ? new Date(d.date) : new Date();
  if (Number.isNaN(date.getTime())) return NextResponse.json({ error: "bad_date" }, { status: 400 });

  try {
    const season = await ensureSeasonFor(session.companyId, date);
    // Till attribution: explicit wins; else the collector's own van (+ today's tournee).
    let locationId = d.locationId ?? null;
    let tourneeId = d.tourneeId ?? null;
    if (!locationId && session.role !== "Admin") {
      const van = await prisma.store.findFirst({
        where: { companyId: session.companyId, kind: "VAN", isActive: true, userId: session.userId },
        select: { id: true },
      });
      locationId = van?.id ?? null;
    }
    if (locationId && !tourneeId) {
      const s = new Date(date);
      s.setHours(0, 0, 0, 0);
      const e = new Date(s);
      e.setDate(e.getDate() + 1);
      const tour = await prisma.tournee.findFirst({
        where: { companyId: session.companyId, locationId, date: { gte: s, lt: e } },
        select: { id: true },
      });
      tourneeId = tour?.id ?? null;
    }
    // Body-supplied location/tournee must belong to this company.
    if (locationId) {
      const loc = await prisma.store.findFirst({ where: { id: locationId, companyId: session.companyId }, select: { id: true } });
      if (!loc) return NextResponse.json({ error: "bad_location" }, { status: 400 });
    }
    if (tourneeId) {
      const t = await prisma.tournee.findFirst({ where: { id: tourneeId, companyId: session.companyId }, select: { id: true } });
      if (!t) return NextResponse.json({ error: "bad_tournee" }, { status: 400 });
    }
    const row = await prisma.$transaction(async (tx) => {
      const v = await tx.versement.create({
        data: {
          companyId: session.companyId,
          seasonId: season.id,
          kind: d.kind,
          clientId: d.clientId ?? null,
          supplierId: d.supplierId ?? null,
          locationId,
          tourneeId,
          amount: d.amount,
          date,
          notes: d.notes ?? null,
        },
      });
      if (d.kind === "CLIENT_PAYMENT" && d.clientId) {
        const c = await tx.customer.findFirst({ where: { id: d.clientId, companyId: session.companyId } });
        if (!c) throw Object.assign(new Error("bad_client"), { status: 400 });
        await tx.customer.update({ where: { id: c.id }, data: { balance: { decrement: d.amount } } });
      }
      if (d.kind === "SUPPLIER_PAYMENT" && d.supplierId) {
        const s = await tx.supplier.findFirst({ where: { id: d.supplierId, companyId: session.companyId } });
        if (!s) throw Object.assign(new Error("bad_supplier"), { status: 400 });
        await tx.supplier.update({ where: { id: s.id }, data: { balance: { decrement: d.amount } } });
      }
      return tx.versement.findUniqueOrThrow({
        where: { id: v.id },
        include: { client: true, supplier: true },
      });
    });
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
