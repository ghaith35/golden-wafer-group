import { NextResponse } from "next/server";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("dili_superadmin", "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
