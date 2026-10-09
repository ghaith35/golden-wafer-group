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
  const { machineId, key, label, specs, phone, workshop, name, contactName, city, email } = (await req.json().catch(() => ({}))) as {
    machineId?: string;
    key?: string;
    label?: string;
    specs?: unknown;
    phone?: string;
    workshop?: string;
    name?: string;
    contactName?: string;
    city?: string;
    email?: string;
  };
  if (!machineId || !key) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

  const candidates = await prisma.licenseKey.findMany({ take: 5000 });
  const record = candidates.find((r) => activationKeysEqual(r.humanKey, key));
  if (!record) return NextResponse.json({ error: "invalid_key" }, { status: 400 });
  if (record.revoked) return NextResponse.json({ error: "key_revoked" }, { status: 403 });
  const boundTo = record.consumedByMachineId ?? record.machineId;
  if (boundTo && boundTo !== machineId) return NextResponse.json({ error: "key_already_used" }, { status: 409 });

  const ip = clientIp(req);
  const { sanitizeSpecs } = await import("@/lib/license/abuse");
  const cleanSpecs = sanitizeSpecs(specs) ?? undefined;
  const cleanWorkshop = workshop?.trim().slice(0, 200) || null;
  const cleanContact = (contactName ?? name)?.trim().slice(0, 200) || null;
  const cleanCity = city?.trim().slice(0, 100) || null;
  const cleanEmail = email?.trim().toLowerCase().slice(0, 160) || null;
  const cleanPhone = phone?.trim().slice(0, 30) || null;
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.licenseKey.update({
      where: { id: record.id },
      data: { machineId, consumedByMachineId: machineId, label: label || record.label },
    });
    await tx.machine.upsert({
      where: { machineId },
      update: {
        label: label || cleanWorkshop || undefined, status: "activated",
        workshop: cleanWorkshop ?? undefined,
        contactName: cleanContact ?? undefined,
        phone: cleanPhone ?? undefined,
        city: cleanCity ?? undefined,
        email: cleanEmail ?? undefined,
        activationKey: row.humanKey, activationType: record.machineId ? "machine" : "preactivated",
        activatedAt: new Date(), lastIp: ip, lastSeen: new Date(),
        ...(cleanSpecs ? { deviceSpecs: cleanSpecs } : {}),
      },
      create: {
        machineId, label: label || cleanWorkshop || cleanContact || null, status: "activated",
        workshop: cleanWorkshop, contactName: cleanContact, phone: cleanPhone,
        city: cleanCity, email: cleanEmail,
        activationKey: row.humanKey, activationType: "preactivated",
        consumedByMachineId: machineId, activatedAt: new Date(), lastIp: ip,
        ...(cleanSpecs ? { deviceSpecs: cleanSpecs } : {}),
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
