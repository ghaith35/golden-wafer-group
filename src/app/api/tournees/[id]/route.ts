import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { tourneeStopsSchema } from "@/lib/sales/validation";
import { setStops, propagateStops, deleteSeries, closeTournee, reorderStops, startDay, finishDay, setTourneeTimes } from "@/lib/tournees/service";
import { optimizeRoute } from "@/lib/routes/optimize";
import { skipOccurrence } from "@/lib/tournees/plans";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const row = await prisma.tournee.findFirst({
    where: { id: (await params).id, companyId: session.companyId },
    include: {
      location: true,
      secteur: true,
      stops: { include: { client: true }, orderBy: { position: "asc" } },
      sales: { include: { client: { select: { id: true, name: true } } } },
    },
  });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (body.action === "close") {
      if (session.role !== "Admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
      return NextResponse.json(await closeTournee(session.companyId, id));
    }
    if (body.action === "optimize") {
      const { startLat, startLng } = body as { startLat?: number; startLng?: number };
      const tournee = await prisma.tournee.findFirst({
        where: { id, companyId: session.companyId },
        include: { stops: { include: { client: { select: { id: true, gpsLat: true, gpsLng: true } } } } },
      });
      if (!tournee) return NextResponse.json({ error: "not_found" }, { status: 404 });
      const start = typeof startLat === "number" && typeof startLng === "number" ? { lat: startLat, lng: startLng } : null;
      const ordered = optimizeRoute(
        tournee.stops.map((s) => ({ id: s.id, lat: s.client.gpsLat, lng: s.client.gpsLng })),
        start
      );
      return NextResponse.json(await reorderStops(session.companyId, id, ordered));
    }
    if (body.action === "reorder" && Array.isArray(body.orderedIds)) {
      return NextResponse.json(await reorderStops(session.companyId, id, body.orderedIds as string[]));
    }
    if (body.action === "start") {
      const { lat, lng } = body as { lat?: unknown; lng?: unknown };
      return NextResponse.json(await startDay(session.companyId, session.userId, session.role, id, undefined, { lat, lng }));
    }
    if (body.action === "finish") {
      const { lat, lng } = body as { lat?: unknown; lng?: unknown };
      return NextResponse.json(await finishDay(session.companyId, session.userId, session.role, id, undefined, { lat, lng }));
    }
    if (body.action === "times") {
      // Admin only: manual départ/fin correction from the presence board.
      if (session.role !== "Admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
      const { startedAt, finishedAt } = body as { startedAt?: string | null; finishedAt?: string | null };
      return NextResponse.json(await setTourneeTimes(
        session.companyId,
        id,
        startedAt ? new Date(startedAt) : null,
        finishedAt ? new Date(finishedAt) : null
      ));
    }
    const parsed = tourneeStopsSchema.safeParse(body);
    if (parsed.success) {
      const updated = await setStops(session.companyId, id, parsed.data.clientIds);
      await propagateStops(session.companyId, id);
      return NextResponse.json(updated);
    }
    return NextResponse.json({ error: "bad_action" }, { status: 400 });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "Admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const existing = await prisma.tournee.findFirst({ where: { id, companyId: session.companyId } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Stops cascade; linked sales survive with a nulled tour link.
  // series=1 (the board): also drops every future open copy of this cell.
  if (new URL(req.url).searchParams.get("series") === "1") {
    await deleteSeries(session.companyId, id);
    await prisma.tournee.deleteMany({ where: { id } });
  } else if (existing.planId) {
    // One day of a recurring plan: the plan keeps running, this date is never regenerated.
    await skipOccurrence(session.companyId, id);
  } else {
    await prisma.tournee.delete({ where: { id } });
  }
  return NextResponse.json({ ok: true });
}

