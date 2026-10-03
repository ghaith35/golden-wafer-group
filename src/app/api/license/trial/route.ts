import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { trialToken, licenseConfigured } from "@/lib/license/sign";

const TRIAL_DAYS = 14;

/// One 14-day trial per machine. Activated machines skip the trial.
export async function POST(req: Request) {
  if (!licenseConfigured()) return NextResponse.json({ error: "license_not_configured" }, { status: 500 });
  const { machineId, label, phone } = (await req.json().catch(() => ({}))) as {
    machineId?: string;
    label?: string;
    phone?: string;
  };
  if (!machineId || typeof machineId !== "string") return NextResponse.json({ error: "bad_machine" }, { status: 400 });

  await prisma.machine.upsert({
    where: { machineId },
    update: { label: label ?? undefined, phone: phone ?? undefined, lastSeen: new Date() },
    create: { machineId, label: label ?? null, phone: phone ?? null },
  });

  const key = await prisma.licenseKey.findFirst({ where: { machineId, revoked: false } });
  if (key) {
    const { activationToken } = await import("@/lib/license/sign");
    return NextResponse.json({ activated: true, token: activationToken(machineId, key.label ?? "", key.humanKey) });
  }

  const existing = await prisma.trialIssue.findUnique({ where: { machineId } });
  if (existing) {
    if (new Date() > existing.end) return NextResponse.json({ trialEnded: true });
    const { trialToken: reissue } = await import("@/lib/license/sign");
    const t = reissue(machineId, Math.max(1, Math.ceil((existing.end.getTime() - Date.now()) / 86400000)));
    return NextResponse.json({ token: t.token });
  }

  const t = trialToken(machineId, TRIAL_DAYS);
  await prisma.trialIssue.create({ data: { machineId, start: new Date(t.start), end: new Date(t.end) } });
  return NextResponse.json({ token: t.token });
}
