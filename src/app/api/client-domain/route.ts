import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeActivationKey } from "@/lib/license/sign";
import { rateLimit, rateLimitKey } from "@/lib/rate-limit";

/// Client self-service: change THEIR domain with the activation code only.
/// POST {code, newDomain?, active?}
/// - The code must be a live (non-revoked) key bound to a machine, and the
///   machine must be linked to a deployment (vendor binds it at sale time).
/// - Sets the OVERRIDE domain only. The primary (first) domain is vendor-only:
///   never returned here, never editable, never deletable — deactivating the
///   override falls back to it.
/// - {active:false} deactivates the override (primary serves again).
export async function POST(req: Request) {
  const rl = rateLimit(rateLimitKey(req, "client-domain"), 10, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const { code, newDomain, active } = (await req.json().catch(() => ({}))) as {
    code?: string;
    newDomain?: string;
    active?: boolean;
  };
  const norm = normalizeActivationKey(String(code ?? ""));
  if (!norm) return NextResponse.json({ error: "bad_code" }, { status: 400 });
  const key = await prisma.licenseKey.findFirst({ where: { humanKey: norm } });
  if (!key || key.revoked) return NextResponse.json({ error: "bad_code" }, { status: 403 });
  const machineId = key.consumedByMachineId || key.machineId;
  if (!machineId) return NextResponse.json({ error: "key_not_bound" }, { status: 403 });
  const dep = await prisma.clientDeployment.findFirst({ where: { machineId } });
  if (!dep) return NextResponse.json({ error: "no_deployment" }, { status: 404 });

  if (typeof newDomain === "string") {
    const d = newDomain.trim().toLowerCase();
    if (d && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return NextResponse.json({ error: "bad_domain" }, { status: 400 });
    if (d && d === dep.domain) return NextResponse.json({ error: "same_as_primary" }, { status: 400 });
    const updated = await prisma.clientDeployment.update({
      where: { id: dep.id },
      data: { domainOverride: d || null, overrideActive: d ? true : false },
    });
    return NextResponse.json({ ok: true, serving: updated.overrideActive ? updated.domainOverride : null });
  }
  if (typeof active === "boolean") {
    if (active && !dep.domainOverride) return NextResponse.json({ error: "no_override" }, { status: 400 });
    const updated = await prisma.clientDeployment.update({
      where: { id: dep.id },
      data: { overrideActive: active },
    });
    return NextResponse.json({ ok: true, serving: updated.overrideActive ? updated.domainOverride : null });
  }
  // Read-only: which domain serves (never the primary).
  return NextResponse.json({ ok: true, serving: dep.overrideActive ? dep.domainOverride : null });
}
