import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";

/// Current signed-in staff member (role drives sidebar filtering).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({
    user: { id: session.userId, username: session.username, role: session.role, companyId: session.companyId },
  });
}
