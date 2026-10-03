import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { newDeviceToken } from "@/lib/sync/validation";

/// Self-registration: a logged-in staff member pairs THIS phone directly —
/// no QR scan, no admin step. The device is bound to the staffer's own van
/// (respects vanBindingMode like any device). Creates a fresh device row
/// per phone and returns its token ONCE.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role === "Admin") return NextResponse.json({ error: "staff_only" }, { status: 403 });
  const { label } = (await req.json().catch(() => ({}))) as { label?: string };
  const van = await prisma.store.findFirst({
    where: { companyId: session.companyId, kind: "VAN", isActive: true, userId: session.userId },
    select: { id: true, name: true },
  });
  if (!van) return NextResponse.json({ error: "no_van" }, { status: 400 });
  const token = newDeviceToken();
  const row = await prisma.device.create({
    data: {
      companyId: session.companyId,
      label: (label?.trim() || `هاتف ${van.name}`).slice(0, 120),
      locationId: van.id,
      userId: session.userId,
      tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
    },
  });
  return NextResponse.json(
    { token, vanId: van.id, vanName: van.name, deviceId: row.id },
    { status: 201 }
  );
}
