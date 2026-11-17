import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { isDesktopUserAgent, isLocalMode, readLocalActivationKey } from "@/lib/license/gate";
import { activationKeysEqual } from "@/lib/license/sign";
import { rateLimit, rateLimitKey } from "@/lib/rate-limit";

/// Desktop installs only (EXE/DMG): reset an ADMIN password by proving
/// ownership with the activation key this install was activated with.
/// POST { key, newPassword, username? }
export async function POST(req: Request) {
  if (!isLocalMode() || !isDesktopUserAgent(req.headers.get("user-agent"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const rl = rateLimit(rateLimitKey(req, "reset-password"), 6, 15 * 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as { key?: string; newPassword?: string; username?: string };
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (newPassword.length < 6) return NextResponse.json({ error: "weak_password" }, { status: 400 });

  const installed = readLocalActivationKey();
  if (!installed) return NextResponse.json({ error: "no_activation_key" }, { status: 400 });
  if (typeof body.key !== "string" || !activationKeysEqual(body.key, installed)) {
    return NextResponse.json({ error: "bad_activation_key" }, { status: 403 });
  }

  const admins = await prisma.user.findMany({ where: { role: "Admin", isActive: true }, select: { id: true, username: true } });
  if (!admins.length) return NextResponse.json({ error: "not_found" }, { status: 404 });
  let target = admins[0];
  if (admins.length > 1) {
    const u = (body.username ?? "").trim().toLowerCase();
    const hit = admins.find((a) => a.username.toLowerCase() === u);
    if (!u || !hit) return NextResponse.json({ error: "username_required" }, { status: 400 });
    target = hit;
  } else if (body.username && body.username.trim() && body.username.trim().toLowerCase() !== target.username.toLowerCase()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: target.id }, data: { passwordHash: await bcrypt.hash(newPassword, 10), passwordView: null } });
    await tx.refreshToken.deleteMany({ where: { userId: target.id } });
  });
  return NextResponse.json({ ok: true, username: target.username });
}
