import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateActivationKey, licenseConfigured } from "@/lib/license/sign";
import { isIpBlocked } from "@/lib/license/abuse";
import { rateLimit, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/superadmin/session";

/// Register a machine (pending). Mints a display key, NEVER a token.
/// Rate-limited; blocked IPs get a silent {ok:true}.
export async function POST(req: Request) {
  if (!licenseConfigured()) return NextResponse.json({ error: "license_not_configured" }, { status: 500 });
  const rl = rateLimit(rateLimitKey(req, "license:register"), 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const { machineId, label, phone, specs, workshop, name, contactName, city, email } = (await req.json().catch(
    () => ({})
  )) as {
    machineId?: string;
    label?: string;
    phone?: string;
    specs?: unknown;
    workshop?: string;
    name?: string;
    contactName?: string;
    city?: string;
    email?: string;
  };
  if (!machineId || typeof machineId !== "string") return NextResponse.json({ error: "bad_machine" }, { status: 400 });
  const ip = clientIp(req);
  if (await isIpBlocked(ip)) return NextResponse.json({ ok: true });
  const { sanitizeSpecs } = await import("@/lib/license/abuse");
  const cleanWorkshop = workshop?.trim().slice(0, 200) || null;
  const cleanContact = (contactName ?? name)?.trim().slice(0, 200) || null;
  const cleanCity = city?.trim().slice(0, 100) || null;
  const cleanEmail = email?.trim().toLowerCase().slice(0, 160) || null;
  const row = await prisma.machine.upsert({
    where: { machineId },
    update: {
      label: label ?? cleanWorkshop ?? undefined,
      workshop: cleanWorkshop ?? undefined,
      contactName: cleanContact ?? undefined,
      phone: phone ?? undefined,
      city: cleanCity ?? undefined,
      email: cleanEmail ?? undefined,
      deviceSpecs: sanitizeSpecs(specs) ?? undefined,
      lastIp: ip,
      lastSeen: new Date(),
    },
    create: {
      machineId,
      label: label ?? cleanWorkshop ?? cleanContact ?? null,
      workshop: cleanWorkshop,
      contactName: cleanContact,
      phone: phone ?? null,
      city: cleanCity,
      email: cleanEmail,
      status: "pending",
      activationKey: generateActivationKey(),
      activationType: "machine",
      deviceSpecs: sanitizeSpecs(specs) ?? undefined,
      lastIp: ip,
    },
  });
  return NextResponse.json({ ok: true, status: row.status, activationKey: row.activationKey ?? null });
}
