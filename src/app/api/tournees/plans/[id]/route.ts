import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { deletePlan } from "@/lib/tournees/plans";

/// End a recurring tour for good: no new days, its future not-started days go.
/// Days already driven stay as history.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "Admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  await deletePlan(session.companyId, id);
  return NextResponse.json({ ok: true });
}
