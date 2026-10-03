import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/settings/helpers";
import { deviceSchema, newDeviceToken } from "@/lib/sync/validation";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
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
  if (d.locationId) {
    const loc = await prisma.store.findFirst({ where: { id: d.locationId, companyId: auth.session.companyId, kind: "VAN" } });
    if (!loc) return NextResponse.json({ error: "bad_van" }, { status: 400 });
  }
  if (d.userId) {
    const u = await prisma.user.findFirst({ where: { id: d.userId, companyId: auth.session.companyId } });
    if (!u) return NextResponse.json({ error: "bad_user" }, { status: 400 });
  }
  const token = newDeviceToken();
  const row = await prisma.device.create({
    data: {
      companyId: auth.session.companyId,
      label: d.label.trim(),
      locationId: d.locationId ?? null,
      userId: d.userId ?? null,
      tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
    },
    include: { location: true, user: { select: { id: true, fullName: true } } },
  });
  return NextResponse.json({ ...row, token }, { status: 201 });
}
