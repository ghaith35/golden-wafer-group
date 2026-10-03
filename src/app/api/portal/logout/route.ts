import { NextResponse } from "next/server";
import { portalCookieSecure } from "@/lib/portal/session";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("portal_token", "", { httpOnly: true, secure: portalCookieSecure(), sameSite: "lax", maxAge: 0, path: "/" });
  return res;
}
