import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { activationToken, trialToken, licenseConfigured, validDzPhone } from "@/lib/license/sign";
import { isIpBlocked } from "@/lib/license/abuse";
import { rateLimit, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/superadmin/session";

const TRIAL_DAYS = 14;

/// Trial: Algerian mobile required, one per machine, server-anchored dates.
/// Blocked IPs get 403 (trial is the abuse vector, not the lock).
export async function POST(req: Request) {
  if (!licenseConfigured()) return NextResponse.json({ error: "license_not_configured" }, { status: 500 });
  const rl = rateLimit(rateLimitKey(req, "license:trial"), 10, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const { machineId, label, phone } = (await req.json().catch(() => ({}))) as {
    machineId?: string;
    label?: string;
    phone?: string;
  };
  if (!machineId || typeof machineId !== "string") return NextResponse.json({ error: "bad_machine" }, { status: 400 });
  if (!validDzPhone(phone ?? "")) return NextResponse.json({ error: "bad_phone" }, { status: 400 });
  const ip = clientIp(req);
  if (await isIpBlocked(ip)) return NextResponse.json({ error: "trial_blocked" }, { status: 403 });

  await prisma.machine.upsert({
    where: { machineId },
    update: { label: label ?? undefined, phone: phone ?? undefined, trialIp: ip, lastIp: ip, lastSeen: new Date() },
    create: { machineId, label: label ?? null, phone: phone ?? null, status: "pending", trialIp: ip, lastIp: ip },
  });

  // Activated (or key-bound) machines skip the trial.
  const key = await prisma.licenseKey.findFirst({ where: { machineId, revoked: false } });
  if (key) {
    return NextResponse.json({ activated: true, token: activationToken(machineId, key.label ?? "", key.humanKey) });
  }
  const machine = await prisma.machine.findUnique({ where: { machineId } });
  if (machine?.status === "revoked") return NextResponse.json({ revoked: true });
  if (machine?.status === "activated") {
    return NextResponse.json({ activated: true, token: activationToken(machineId, machine.label ?? "", machine.activationKey ?? undefined) });
  }

  const existing = await prisma.trialIssue.findUnique({ where: { machineId } });
  if (existing) {
    if (new Date() > existing.end) return NextResponse.json({ trialEnded: true });
    const t = trialToken(machineId, Math.max(1, Math.ceil((existing.end.getTime() - Date.now()) / 86400000)));
    await prisma.machine.update({ where: { machineId }, data: { trialStart: existing.start, trialEnd: existing.end } });
    return NextResponse.json({ token: t.token, trialEndsAt: existing.end });
  }

  const t = trialToken(machineId, TRIAL_DAYS);
  await prisma.$transaction([
    prisma.trialIssue.create({ data: { machineId, start: new Date(t.start), end: new Date(t.end) } }),
    prisma.machine.update({ where: { machineId }, data: { trialStart: new Date(t.start), trialEnd: new Date(t.end) } }),
  ]);
  return NextResponse.json({ token: t.token, trialEndsAt: t.end });
}
