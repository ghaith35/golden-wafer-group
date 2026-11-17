import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { ensureWeekTours } from "@/lib/tournees/service";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "Admin") return NextResponse.json({ created: 0 });
  const { weekStart } = (await req.json().catch(() => ({}))) as { weekStart?: string };
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return NextResponse.json({ error: "bad_week" }, { status: 400 });
  }
  const created = await ensureWeekTours(session.companyId, weekStart, 12);
  return NextResponse.json({ created });
}
