import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/settings/helpers";
import { deviceSchema, newDeviceToken } from "@/lib/sync/validation";
import { normalizeDomain, isPublicHttpsOrigin } from "@/lib/sync/urls";
import { ensurePublicHostname, explicitHostnameOrigin } from "@/lib/sync/public-host";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  await ensurePublicHostname(auth.session.companyId).catch(() => {});
  const rows = await prisma.device.findMany({
    where: { companyId: auth.session.companyId },
    include: {
      location: { select: { id: true, name: true, matricule: true } },
      user: { select: { id: true, fullName: true, username: true } },
      _count: { select: { ops: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(rows);
}

/// Register a device (one APK). Returns the token ONCE — embed it in the APK.
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const parsed = deviceSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  const d = parsed.data;
  await ensurePublicHostname(auth.session.companyId).catch(() => {});
  const settings = await prisma.companySettings.findUnique({
    where: { companyId: auth.session.companyId },
    select: { remoteDomain: true },
  });
  const setupUrl = normalizeDomain(settings?.remoteDomain ?? "");
  if (!setupUrl) return NextResponse.json({ error: "public_domain_missing" }, { status: 409 });
  if (!isPublicHttpsOrigin(setupUrl)) return NextResponse.json({ error: "public_domain_https_required" }, { status: 400 });
  if (!d.locationId || !d.userId) return NextResponse.json({ error: "pair_required" }, { status: 400 });
  const van = await prisma.store.findFirst({
    where: { id: d.locationId, companyId: auth.session.companyId, kind: "VAN", isActive: true },
    include: { user: true },
  });
  if (!van) return NextResponse.json({ error: "bad_van" }, { status: 400 });
  if (!van.userId || van.userId !== d.userId || !van.user?.isActive || van.user.role === "Admin") {
    return NextResponse.json({ error: "van_unassigned" }, { status: 400 });
  }
  const token = newDeviceToken();
  const row = await prisma.device.create({
    data: {
      companyId: auth.session.companyId,
      label: d.label.trim(),
      locationId: van.id,
      userId: van.userId,
      tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
    },
    include: { location: true, user: { select: { id: true, fullName: true } } },
  });
  return NextResponse.json({ ...row, token, setupUrl }, { status: 201 });
}

/// Set the phone-link domain from Settings → Devices.
/// Default is client1; admin can change to client2, client3… QR updates instantly.
/// Rejected when a per-install file/env override is active (that wins).
export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (explicitHostnameOrigin()) {
    return NextResponse.json({ error: "explicit_override" }, { status: 409 });
  }
  const body = (await req.json().catch(() => ({}))) as { remoteDomain?: unknown };
  if (typeof body.remoteDomain !== "string" || !body.remoteDomain.trim()) {
    return NextResponse.json({ error: "domain_required" }, { status: 400 });
  }
  const origin = normalizeDomain(body.remoteDomain.trim()).replace(/\/+$/, "");
  if (!isPublicHttpsOrigin(origin)) {
    return NextResponse.json({ error: "invalid_public_domain" }, { status: 400 });
  }
  await prisma.companySettings.upsert({
    where: { companyId: auth.session.companyId },
    update: { remoteDomain: origin },
    create: { companyId: auth.session.companyId, remoteDomain: origin },
  });
  return NextResponse.json({ remoteDomain: origin });
}
