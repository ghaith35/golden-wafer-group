import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { materializePlans, LOOKAHEAD_DAYS } from "@/lib/tournees/plans";
import { addDaysKey } from "@/lib/tournees/days";

/// Board open: make sure every recurring plan has its daily tours for the
/// shown week and the weeks right after it (rolling — plans never run out).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "Admin") return NextResponse.json({ created: 0 });
  const { weekStart } = (await req.json().catch(() => ({}))) as { weekStart?: string };
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return NextResponse.json({ error: "bad_week" }, { status: 400 });
  }
  const created = await materializePlans(session.companyId, { fromKey: weekStart, toKey: addDaysKey(weekStart, 6 + LOOKAHEAD_DAYS) });
  return NextResponse.json({ created });
}
