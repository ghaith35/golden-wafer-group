import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { activationToken, activationKeysEqual, licenseConfigured } from "@/lib/license/sign";
import { rateLimit, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/superadmin/session";

/// Redeem a key (4×5 new, DILI- legacy). Pool keys bind first-device-wins;
/// machine keys re-verify. Consumed pool rows keep the key for poll signing.
export async function POST(req: Request) {
  if (!licenseConfigured()) return NextResponse.json({ error: "license_not_configured" }, { status: 500 });
  const rl = rateLimit(rateLimitKey(req, "license:redeem"), 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const { machineId, key, label } = (await req.json().catch(() => ({}))) as {
    machineId?: string;
    key?: string;
    label?: string;
  };
  if (!machineId || !key) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

  const candidates = await prisma.licenseKey.findMany({ take: 5000 });
  const record = candidates.find((r) => activationKeysEqual(r.humanKey, key));
  if (!record) return NextResponse.json({ error: "invalid_key" }, { status: 400 });
  if (record.revoked) return NextResponse.json({ error: "key_revoked" }, { status: 403 });
  const boundTo = record.consumedByMachineId ?? record.machineId;
  if (boundTo && boundTo !== machineId) return NextResponse.json({ error: "key_already_used" }, { status: 409 });

  const ip = clientIp(req);
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.licenseKey.update({
      where: { id: record.id },
      data: { machineId, consumedByMachineId: machineId, label: label || record.label },
    });
    await tx.machine.upsert({
      where: { machineId },
      update: {
        label: label ?? undefined, status: "activated",
        activationKey: row.humanKey, activationType: record.machineId ? "machine" : "preactivated",
        activatedAt: new Date(), lastIp: ip, lastSeen: new Date(),
      },
      create: {
        machineId, label: label ?? null, status: "activated",
        activationKey: row.humanKey, activationType: "preactivated",
        consumedByMachineId: machineId, activatedAt: new Date(), lastIp: ip,
      },
    });
    await tx.machineSubscription.upsert({
      where: { machineId },
      update: { status: "active" },
      create: { machineId, plan: "standard", status: "active" },
    });
    return row;
  });
  return NextResponse.json({ token: activationToken(machineId, updated.label ?? "", updated.humanKey) });
}
