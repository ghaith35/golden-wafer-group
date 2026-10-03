import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { moveStop } from "@/lib/tournees/service";

/// Day-to-day client move (planning board drag-and-drop).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "Admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { stopId, toTourneeId } = (await req.json().catch(() => ({}))) as {
    stopId?: string;
    toTourneeId?: string;
  };
  if (!stopId || !toTourneeId) return NextResponse.json({ error: "validation_error" }, { status: 400 });
  try {
    return NextResponse.json(await moveStop(session.companyId, stopId, toTourneeId));
  } catch (e: unknown) {
    const err = e as { message?: string; status?: number };
    return NextResponse.json({ error: err.message ?? "move_failed" }, { status: err.status ?? 500 });
  }
}
