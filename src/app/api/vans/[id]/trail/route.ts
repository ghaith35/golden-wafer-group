import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { algiersDayRange } from "@/lib/tournees/days";

/// The van's trail for one Algiers calendar day (default today): ordered
/// points for the admin map. Long days are thinned evenly to ≤ 1500 points.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const van = await prisma.store.findFirst({ where: { id, companyId: session.companyId, kind: "VAN" }, select: { id: true, name: true } });
  if (!van) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const day = new URL(req.url).searchParams.get("day");
  const base = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T12:00:00Z`) : new Date();
  const range = algiersDayRange(base);
  const rows = await prisma.vanPosition.findMany({
    where: { vanId: van.id, recordedAt: { gte: range.gte, lt: range.lt } },
    orderBy: { recordedAt: "asc" },
    select: { lat: true, lng: true, accuracy: true, speed: true, recordedAt: true },
    take: 20000,
  });
  const step = Math.max(1, Math.ceil(rows.length / 1500));
  const points = rows
    .filter((_, i) => i % step === 0 || i === rows.length - 1)
    .map((r) => ({ lat: r.lat, lng: r.lng, speed: r.speed, accuracy: r.accuracy, t: r.recordedAt.toISOString() }));
  return NextResponse.json({ van, count: rows.length, points });
}
