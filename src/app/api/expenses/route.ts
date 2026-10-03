import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { expenseSchema } from "@/lib/cash/validation";
import { ensureSeasonFor } from "@/lib/docs/sequences";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const typeId = sp.get("typeId");
  const locationId = sp.get("locationId");
  const month = Number(sp.get("month") ?? 0);
  const year = Number(sp.get("year") ?? 0);
  let range: { gte: Date; lt: Date } | undefined;
  if (month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
    range = { gte: new Date(year, month - 1, 1), lt: new Date(year, month, 1) };
  }
  const rows = await prisma.expense.findMany({
    where: {
      companyId: session.companyId,
      deletedAt: null,
      ...(typeId ? { typeId } : {}),
      ...(locationId ? { locationId } : {}),
      ...(range ? { expenseDate: range } : {}),
    },
    include: { type: true, location: { select: { id: true, name: true } } },
    orderBy: { expenseDate: "desc" },
    take: 500,
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = expenseSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  const d = parsed.data;
  if (d.typeId) {
    const t = await prisma.expenseType.findFirst({ where: { id: d.typeId, companyId: session.companyId } });
    if (!t) return NextResponse.json({ error: "bad_type" }, { status: 400 });
  }
  if (d.locationId) {
    const l = await prisma.store.findFirst({ where: { id: d.locationId, companyId: session.companyId } });
    if (!l) return NextResponse.json({ error: "bad_location" }, { status: 400 });
  }
  const date = d.expenseDate ? new Date(d.expenseDate) : new Date();
  const season = await ensureSeasonFor(session.companyId, date);
  const row = await prisma.expense.create({
    data: {
      companyId: session.companyId,
      seasonId: season.id,
      typeId: d.typeId ?? null,
      locationId: d.locationId ?? null,
      label: d.label.trim(),
      description: d.description?.trim() || null,
      amount: d.amount,
      expenseDate: date,
    },
    include: { type: true, location: true },
  });
  return NextResponse.json(row, { status: 201 });
}
