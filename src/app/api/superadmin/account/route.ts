import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { audit, checkPassword, clientIp, hashPassword, requireSuperAdmin, signSuperAdminToken } from "@/lib/superadmin/session";

const COOKIE_SECURE = process.env.COOKIE_SECURE != null ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production";

export async function PATCH(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => ({}))) as { currentPassword?: string; username?: string; newPassword?: string };
  if (typeof body.currentPassword !== "string" || !body.currentPassword) return NextResponse.json({ error: "current_password_required" }, { status: 400 });
  if (body.username !== undefined && typeof body.username !== "string") return NextResponse.json({ error: "invalid_username" }, { status: 400 });
  if (body.newPassword !== undefined && typeof body.newPassword !== "string") return NextResponse.json({ error: "weak_password" }, { status: 400 });
  const admin = await prisma.superAdminUser.findUnique({ where: { id: auth.admin.adminId } });
  if (!admin || !(await checkPassword(body.currentPassword, admin.passwordHash))) {
    return NextResponse.json({ error: "invalid_current_password" }, { status: 403 });
  }
  const username = body.username?.trim();
  const newPassword = body.newPassword;
  if (!username && !newPassword) return NextResponse.json({ error: "no_changes" }, { status: 400 });
  if (body.username !== undefined && (!username || username.length > 80)) return NextResponse.json({ error: "invalid_username" }, { status: 400 });
  if (newPassword !== undefined && newPassword.length < 8) return NextResponse.json({ error: "weak_password" }, { status: 400 });
  try {
    const updated = await prisma.superAdminUser.update({
      where: { id: admin.id },
      data: {
        ...(username ? { username } : {}),
        ...(newPassword ? { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() } : {}),
      },
    });
    await audit(admin.id, "account_updated", "superadmin", admin.id, { usernameChanged: !!username, passwordChanged: !!newPassword }, clientIp(req) ?? undefined);
    const token = await signSuperAdminToken({ adminId: updated.id, username: updated.username });
    const res = NextResponse.json({ ok: true, username: updated.username });
    res.cookies.set("dili_superadmin", token, { httpOnly: true, secure: COOKIE_SECURE, sameSite: "strict", maxAge: 4 * 3600, path: "/" });
    return res;
  } catch (error) {
    return NextResponse.json({ error: (error as { code?: string })?.code === "P2002" ? "username_taken" : "update_failed" }, { status: 409 });
  }
}