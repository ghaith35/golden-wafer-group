import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

/// Current signed-in staff member (role drives sidebar filtering).
/// Role is read fresh from the DB (not the JWT) so a promote/demote or
/// role fix applies without forcing everyone to re-login.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { username: true, role: true },
  });
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({
    user: { id: session.userId, username: user.username, role: user.role, companyId: session.companyId },
  });
}
