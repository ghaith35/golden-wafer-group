import { NextResponse } from "next/server";
import { cookieSecure } from "@/lib/auth/session";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  const secure = cookieSecure();
  res.cookies.set("access_token", "", { httpOnly: true, secure, sameSite: "lax", maxAge: 0, path: "/" });
  res.cookies.set("refresh_token", "", { httpOnly: true, secure, sameSite: "lax", maxAge: 0, path: "/" });
  return res;
}
