import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSuperAdmin, hashPassword } from "@/lib/superadmin/session";

/// Rotate own password (also clears the must-change flag).
export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!password || password.length < 8) return NextResponse.json({ error: "weak_password" }, { status: 400 });
  await prisma.superAdminUser.update({
    where: { id: auth.admin.adminId },
    data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
