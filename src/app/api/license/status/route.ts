import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { activationToken, licenseConfigured } from "@/lib/license/sign";
import { rateLimit, rateLimitKey } from "@/lib/rate-limit";

/// Unified poll (every 30s by running installs): one shape, definitive.
/// {status: pending|active|revoked, token?, trialEndsAt?}
/// Fail-open lives client-side: only an explicit revoked kills.
export async function GET(req: Request) {
  const machineId = new URL(req.url).searchParams.get("machineId");
  if (!machineId || !licenseConfigured()) return NextResponse.json({});
  const rl = rateLimit(rateLimitKey(req, "license:status"), 120, 60_000);
  if (!rl.ok) return NextResponse.json({});
  const machine = await prisma.machine.findUnique({ where: { machineId } });
  if (!machine) return NextResponse.json({ status: "pending" });
  if (machine.status === "revoked") return NextResponse.json({ status: "revoked", revoked: true });
  // Key-bound and healthy → FRESH token (self-heals pre-token rows AND stale
  // machine.token rows signed with a rotated/ALT key the installer rejects).
  // The stored token is refreshed best-effort so the next poll converges.
  const key = await prisma.licenseKey.findFirst({ where: { machineId, revoked: false } });
  if (key || machine.status === "activated") {
    const label = key?.label ?? machine.label ?? "";
    const humanKey = key?.humanKey ?? machine.activationKey ?? undefined;
    const token = activationToken(machineId, label, humanKey);
    void prisma.machine.update({ where: { machineId }, data: { token, lastSeen: new Date() } }).catch(() => {});
    return NextResponse.json({ status: "active", token });
  }
  if (machine.trialEnd && new Date() > machine.trialEnd) return NextResponse.json({ status: "pending", trialEnded: true });
  const trial = await prisma.trialIssue.findUnique({ where: { machineId } });
  if (trial && new Date() > trial.end) return NextResponse.json({ status: "pending", trialEnded: true });
  return NextResponse.json({ status: "pending", trialEndsAt: machine.trialEnd ?? trial?.end ?? null });
}
