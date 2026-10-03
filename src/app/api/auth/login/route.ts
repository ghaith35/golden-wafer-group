import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { signAccessToken, signRefreshToken, cookieSecure, ACCESS_MAX_AGE, REFRESH_MAX_AGE } from "@/lib/auth/session";
import crypto from "node:crypto";

export async function POST(req: Request) {
  const { username, password, qrToken } = (await req.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
    qrToken?: string;
  };

  // QR scan login: long-lived staff token (revocable via regenerate).
  // Payload format: {"app":"distribuili","type":"staff-login","u":"...","k":"..."}
  // — the client may send the raw token or the full JSON payload.
  let token: string | null = null;
  if (typeof qrToken === "string" && qrToken.trim()) {
    const raw = qrToken.trim();
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.k === "string") token = parsed.k;
      else token = raw;
    } catch {
      token = raw;
    }
  }
  if (token) {
    const user = await prisma.user.findFirst({
      where: { qrToken: token, isActive: true },
      include: { company: true },
    });
    if (!user) return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
    if (username && user.username.toLowerCase() !== String(username).trim().toLowerCase()) {
      return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
    }
    return issueSession(user);
  }

  if (!username || !password) return NextResponse.json({ error: "missing_credentials" }, { status: 400 });

  // Username matches case-insensitively: phone keyboards autocapitalize the
  // first letter, which otherwise locks mobile users out with a 401.
  // Staff may also sign in with their phone number (User.phone).
  const ident = username.trim();
  const user = await prisma.user.findFirst({
    where: { OR: [{ username: { equals: ident, mode: "insensitive" } }, { phone: ident }], isActive: true },
    include: { company: true },
  });
  if (!user) return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });

  return issueSession(user);
}

type SessionUser = {
  id: string;
  companyId: string;
  username: string;
  role: string;
  company: { name: string };
};

async function issueSession(user: SessionUser) {
  const claims = { sub: user.id, companyId: user.companyId, username: user.username, role: user.role };
  const accessToken = await signAccessToken(claims);
  const refreshToken = await signRefreshToken(claims);
  const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
  await prisma.refreshToken.create({ data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + REFRESH_MAX_AGE * 1000) } });

  const res = NextResponse.json({ ok: true, user: { id: user.id, username: user.username, role: user.role, company: user.company.name } });
  const secure = cookieSecure();
  res.cookies.set("access_token", accessToken, { httpOnly: true, secure, sameSite: "lax", maxAge: ACCESS_MAX_AGE, path: "/" });
  res.cookies.set("refresh_token", refreshToken, { httpOnly: true, secure, sameSite: "lax", maxAge: REFRESH_MAX_AGE, path: "/" });
  return res;
}
