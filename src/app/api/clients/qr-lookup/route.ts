import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { parseClientScan } from "@/lib/clients/qr";
import { prisma } from "@/lib/db";
import { dayBounds } from "@/lib/livreur/day-access";

/// Day slug `yyyy-m-d` (same format as the livreur URL).
function parseDay(slug: unknown): Date | null {
  const m = typeof slug === "string" ? /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(slug) : null;
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const match = typeof body?.qr === "string" ? parseClientScan(body.qr, session.companyId) : null;
  if (!match) return NextResponse.json(null);

  // Day scope (journée screens): a van user only reaches clients planned in
  // THAT day's tour, plus clients he registered that same day.
  let dayScope: object = {};
  const date = session.role === "Admin" ? null : parseDay(body?.day);
  if (date) {
    const van = await prisma.store.findFirst({
      where: { companyId: session.companyId, kind: "VAN", isActive: true, userId: session.userId },
      select: { id: true },
    });
    if (van) {
      const { start, end } = dayBounds(date);
      dayScope = {
        OR: [
          { tourneeStops: { some: { tournee: { companyId: session.companyId, locationId: van.id, date: { gte: start, lte: end } } } } },
          { createdAt: { gte: start, lte: end } },
        ],
      };
    }
  }

  const client = await prisma.customer.findFirst({
    where: { companyId: session.companyId, isActive: true, ...match, ...dayScope },
    select: { id: true, name: true, code: true, phone: true, gpsLat: true, gpsLng: true, tierId: true, balance: true },
  });
  return NextResponse.json(client);
}
