import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { listPlans } from "@/lib/tournees/plans";

/// Active recurring tours (the board's ghost chips for weeks they are not due).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await listPlans(session.companyId));
}
