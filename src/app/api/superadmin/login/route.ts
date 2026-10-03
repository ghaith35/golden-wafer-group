import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { signSuperAdminToken, checkPassword, audit, clientIp } from "@/lib/superadmin/session";
import { rateLimit, rateLimitKey } from "@/lib/rate-limit";

const COOKIE_SECURE =
  process.env.COOKIE_SECURE != null ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production";

/// Vendor login. Fake-hash timing defense + must-change-password signal.
export async function POST(req: Request) {
  const rl = rateLimit(rateLimitKey(req, "superadmin:login"), 10, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const { username, password } = (await req.json().catch(() => ({}))) as { username?: string; password?: string };
  if (!username || !password) {
    await checkPassword("dummy-password-for-timing", "$2b$10$DUMMYDUMMYDUMMYDUMMYDUMMYDUMMYDUMMYDUMMYDUMMYDUM");
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }
  const admin = await prisma.superAdminUser.findUnique({ where: { username: username.trim() } });
  const valid = admin && admin.isActive ? await checkPassword(password, admin.passwordHash) : false;
  if (!admin || !valid) {
    if (admin) await checkPassword(password, admin.passwordHash);
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }
  const token = await signSuperAdminToken({ adminId: admin.id, username: admin.username });
  await audit(admin.id, "login", undefined, undefined, undefined, clientIp(req) ?? undefined);
  const res = NextResponse.json({ ok: true, mustChangePassword: admin.passwordChangedAt == null });
  res.cookies.set("dili_superadmin", token, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "strict",
    maxAge: 4 * 3600,
    path: "/",
  });
  return res;
}
