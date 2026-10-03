import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

/// Desktop "Suivi" feed: every active van with its last known GPS position.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const vans = await prisma.store.findMany({
    where: { companyId: session.companyId, kind: "VAN", isActive: true },
    select: {
      id: true, name: true, marque: true, matricule: true,
      lastLat: true, lastLng: true, lastSeenAt: true, locateRequestedAt: true,
      user: { select: { id: true, fullName: true, username: true } },
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({
    now: new Date().toISOString(),
    vans: vans.map((v) => ({
      id: v.id,
      name: v.name,
      marque: v.marque,
      matricule: v.matricule,
      lat: v.lastLat !== null && v.lastLat !== undefined ? Number(v.lastLat) : null,
      lng: v.lastLng !== null && v.lastLng !== undefined ? Number(v.lastLng) : null,
      seenAt: v.lastSeenAt,
      locateRequested: v.locateRequestedAt != null,
      driver: v.user ? { fullName: v.user.fullName, username: v.user.username } : null,
    })),
  });
}
