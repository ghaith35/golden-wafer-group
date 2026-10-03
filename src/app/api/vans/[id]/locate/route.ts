import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

/// Office → van: "send me your location now". Sets a flag the driver's APK
/// polls (POST /api/track/pending or the `locateRequested` field of
/// POST /api/track). Cleared automatically on the next position report.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const van = await prisma.store.findFirst({
    where: { id, companyId: session.companyId, kind: "VAN", isActive: true },
    select: { id: true, name: true },
  });
  if (!van) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await prisma.store.update({ where: { id: van.id }, data: { locateRequestedAt: new Date() } });
  return NextResponse.json({ ok: true, vanId: van.id, name: van.name });
}
