import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { locationSchema } from "@/lib/inventory/validation";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await prisma.store.findMany({
    where: { companyId: session.companyId },
    include: { user: { select: { id: true, fullName: true, username: true, role: true } } },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = locationSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  const d = parsed.data;
  if (d.kind === "VAN" && (!d.marque?.trim() || !d.matricule?.trim())) {
    return NextResponse.json({ error: "van_fields_required" }, { status: 400 });
  }
  if (d.userId) {
    const u = await prisma.user.findFirst({ where: { id: d.userId, companyId: session.companyId } });
    if (!u || u.role === "Admin") return NextResponse.json({ error: "bad_user" }, { status: 400 });
    // One driver ↔ max one van.
    const busy = await prisma.store.findFirst({
      where: { companyId: session.companyId, userId: d.userId },
      select: { name: true },
    });
    if (busy) return NextResponse.json({ error: "driver_busy", van: busy.name }, { status: 409 });
  }
  let row;
  try {
    row = await prisma.store.create({
      data: {
        companyId: session.companyId,
        name: d.name.trim(),
        address: d.address?.trim() || null,
        kind: d.kind,
        marque: d.marque?.trim() || null,
        matricule: d.matricule?.trim() || null,
        imageUrl: d.imageUrl?.trim() || null,
        userId: d.userId ?? null,
      },
    });
  } catch (e) {
    if (String(e).includes("stores_companyId_userId_key")) {
      return NextResponse.json({ error: "driver_busy" }, { status: 409 });
    }
    throw e;
  }
  return NextResponse.json(row, { status: 201 });
}
