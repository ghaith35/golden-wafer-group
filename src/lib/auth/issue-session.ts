import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { signAccessToken, signRefreshToken, cookieSecure, ACCESS_MAX_AGE, REFRESH_MAX_AGE } from "@/lib/auth/session";

type SessionUser = {
  id: string;
  companyId: string;
  username: string;
  role: string;
  company: { name: string };
};

export async function issueSession(user: SessionUser, status = 200) {
  const claims = { sub: user.id, companyId: user.companyId, username: user.username, role: user.role };
  const accessToken = await signAccessToken(claims);
  const refreshToken = await signRefreshToken(claims);
  const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + REFRESH_MAX_AGE * 1000) },
  });

  const response = NextResponse.json(
    { ok: true, user: { id: user.id, username: user.username, role: user.role, company: user.company.name } },
    { status },
  );
  const secure = cookieSecure();
  response.cookies.set("access_token", accessToken, { httpOnly: true, secure, sameSite: "lax", maxAge: ACCESS_MAX_AGE, path: "/" });
  response.cookies.set("refresh_token", refreshToken, { httpOnly: true, secure, sameSite: "lax", maxAge: REFRESH_MAX_AGE, path: "/" });
  return response;
}