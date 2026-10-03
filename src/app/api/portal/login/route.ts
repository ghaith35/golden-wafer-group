import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { signPortalToken, portalCookieSecure } from "@/lib/portal/session";

/// Portal login: phone (username) + secret code.
export async function POST(req: Request) {
  const { phone, secret, companyId } = (await req.json().catch(() => ({}))) as {
    phone?: string;
    secret?: string;
    companyId?: string;
  };
  if (!phone || !secret) return NextResponse.json({ error: "missing_credentials" }, { status: 400 });

  const client = await prisma.customer.findFirst({
    where: {
      phone: phone.trim(),
      isActive: true,
      ...(companyId ? { companyId } : {}),
    },
    include: { tier: true },
  });
  if (!client || !client.portalSecretHash) return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  const ok = await bcrypt.compare(secret.trim(), client.portalSecretHash);
  if (!ok) return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });

  const token = await signPortalToken({ clientId: client.id, companyId: client.companyId });
  const res = NextResponse.json({
    ok: true,
    client: { id: client.id, name: client.name, code: client.code, tier: client.tier?.name ?? null },
  });
  res.cookies.set("portal_token", token, {
    httpOnly: true,
    secure: portalCookieSecure(),
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return res;
}
