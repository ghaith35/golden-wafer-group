import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { tourneeSchema, tourneeStopsSchema } from "@/lib/sales/validation";
import { createTournee } from "@/lib/tournees/service";
import { addDaysKey, algiersDayRange } from "@/lib/tournees/days";

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
    if (!Number.isNaN(d.getTime())) dayRange = algiersDayRange(d);
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
  const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = tourneeSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  const findOrCreate = raw.findOrCreate === true;
  // Staff may only plan their OWN van (the start-day auto-create path sends
  // locationId "__mine__"). Admins keep full planning power.
  let data = parsed.data;
  if (session.role !== "Admin") {
    const ownVan = await prisma.store.findFirst({
      where: { companyId: session.companyId, kind: "VAN", userId: session.userId },
      select: { id: true },
    });
    if (!ownVan) return NextResponse.json({ error: "no_van" }, { status: 400 });
    if (data.locationId !== ownVan.id && data.locationId !== "__mine__") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    data = { ...data, locationId: ownVan.id, clientIds: [] };
  }
  try {
    const { repeatWeeks, ...one } = data;
    const row = await createTournee(session.companyId, one);
    // Weekly repeat (admin only, date-only input): same van + secteur on the
    // same weekday for the following weeks; weeks that already have an open
    // tour for this van are skipped.
    if (session.role === "Admin" && repeatWeeks && /^\d{4}-\d{2}-\d{2}$/.test(one.date)) {
      for (let k = 1; k <= repeatWeeks; k++) {
        try {
          await createTournee(session.companyId, { ...one, date: addDaysKey(one.date, 7 * k) });
        } catch (e) {
          if ((e as Error).message !== "duplicate_day") throw e;
        }
      }
    }
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    const err = e as Error & { status?: number };
    // Start-day race: a tour appeared between page load and tap — hand back
    // the winner so départ stamps instead of erroring.
    if (err.message === "duplicate_day" && findOrCreate) {
      const winner = await prisma.tournee.findFirst({
        where: { companyId: session.companyId, locationId: data.locationId, status: "OPEN", date: algiersDayRange(new Date(data.date as string)) },
        orderBy: { createdAt: "desc" },
      });
      if (winner) return NextResponse.json(winner);
    }
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
