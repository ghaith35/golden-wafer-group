import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { tourneeSchema, tourneeStopsSchema } from "@/lib/sales/validation";
import { createTournee, setStops, closeTournee } from "@/lib/tournees/service";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const date = sp.get("date");
  const locationId = sp.get("locationId");
  const status = sp.get("status");
  const take = Math.min(Math.max(Number(sp.get("take") ?? 100) || 100, 1), 500);
  let dayRange: { gte: Date; lt: Date } | undefined;
  if (date) {
    const d = new Date(date);
    if (!Number.isNaN(d.getTime())) {
      const start = new Date(d);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      dayRange = { gte: start, lt: end };
    }
  }
  const rows = await prisma.tournee.findMany({
    where: {
      companyId: session.companyId,
      ...(dayRange ? { date: dayRange } : {}),
      ...(locationId ? { locationId } : {}),
      ...(status ? { status: status as never } : {}),
    },
    include: {
      location: true,
      secteur: true,
      stops: { include: { client: { select: { id: true, name: true, code: true, phone: true, gpsLat: true, gpsLng: true } } }, orderBy: { position: "asc" } },
      _count: { select: { sales: true } },
    },
    orderBy: { date: "desc" },
    take,
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = tourneeSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  try {
    const row = await createTournee(session.companyId, parsed.data);
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
