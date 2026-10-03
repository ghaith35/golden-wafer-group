import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { computeTrips, type LatLng } from "@/lib/geo-math";

type Row = { clientId: string; distanceM: number; durationS: number; source: string; updatedAt: Date };

function shape(rows: Row[]) {
  return {
    rows: rows.map((r) => ({
      clientId: r.clientId,
      distM: Number(r.distanceM),
      durS: Number(r.durationS),
      source: r.source,
      updatedAt: r.updatedAt,
    })),
  };
}

/// The signed-in user's last saved distance/time snapshot.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await prisma.clientDistance.findMany({
    where: { companyId: session.companyId, userId: session.userId },
  });
  return NextResponse.json(shape(rows));
}

/// Recompute from a fresh position and persist per-user snapshot.
/// Falls back to straight-line estimates when the router is unreachable.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { lat, lng } = (await req.json().catch(() => ({}))) as { lat?: number; lng?: number };
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "validation_error" }, { status: 400 });
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "validation_error" }, { status: 400 });
  }
  const from: LatLng = { lat, lng };
  const clients = await prisma.customer.findMany({
    where: { companyId: session.companyId, gpsLat: { not: null }, gpsLng: { not: null } },
    select: { id: true, gpsLat: true, gpsLng: true },
    take: 500,
  });
  const trips = await computeTrips(
    from,
    clients.map((c) => ({ id: c.id, lat: Number(c.gpsLat), lng: Number(c.gpsLng) }))
  );
  await prisma.$transaction(
    trips.map((t) =>
      prisma.clientDistance.upsert({
        where: { companyId_userId_clientId: { companyId: session.companyId, userId: session.userId, clientId: t.id } },
        update: { distanceM: t.distM, durationS: t.durS, atLat: lat, atLng: lng, source: t.source },
        create: {
          companyId: session.companyId, userId: session.userId, clientId: t.id,
          distanceM: t.distM, durationS: t.durS, atLat: lat, atLng: lng, source: t.source,
        },
      })
    )
  );
  const rows = await prisma.clientDistance.findMany({
    where: { companyId: session.companyId, userId: session.userId },
  });
  return NextResponse.json(shape(rows));
}
