import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { clientSchema, generatePortalSecret, legacyQrSchema } from "@/lib/clients/validation";

async function scoped(id: string, companyId: string) {
  return prisma.customer.findFirst({
    where: { id, companyId },
    include: { tier: true, secteur: { include: { wilaya: true } }, wilaya: true },
  });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const row = await scoped((await params).id, session.companyId);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { portalSecretHash: _omit, ...safe } = row;
  return NextResponse.json(safe);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await prisma.customer.findFirst({ where: { id, companyId: session.companyId } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = clientSchema.partial().extend({ legacyQr: legacyQrSchema.optional() }).safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    const error = parsed.error.issues.some((issue) => issue.path[0] === "legacyQr") ? "bad_legacy_qr" : "validation_error";
    return NextResponse.json({ error, issues: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;
  if (d.tierId) {
    const tier = await prisma.priceTier.findFirst({ where: { id: d.tierId, companyId: session.companyId } });
    if (!tier) return NextResponse.json({ error: "bad_tier" }, { status: 400 });
  }
  if (d.secteurId) {
    const sec = await prisma.secteur.findFirst({ where: { id: d.secteurId, companyId: session.companyId } });
    if (!sec) return NextResponse.json({ error: "bad_secteur" }, { status: 400 });
  }
  try {
    const row = await prisma.customer.update({
      where: { id },
      data: {
        ...(d.legacyQr !== undefined ? { legacyQr: d.legacyQr } : {}),
        ...(d.name !== undefined ? { name: d.name.trim() } : {}),
        ...(d.phone !== undefined ? { phone: d.phone?.trim() || null } : {}),
        ...(d.address !== undefined ? { address: d.address?.trim() || null } : {}),
        ...(d.wilayaCode !== undefined ? { wilayaCode: d.wilayaCode } : {}),
        ...(d.secteurId !== undefined ? { secteurId: d.secteurId } : {}),
        ...(d.activityType !== undefined ? { activityType: d.activityType?.trim() || null } : {}),
        ...(d.rc !== undefined ? { rc: d.rc?.trim() || null } : {}),
        ...(d.ai !== undefined ? { ai: d.ai?.trim() || null } : {}),
        ...(d.nif !== undefined ? { nif: d.nif?.trim() || null } : {}),
        ...(d.nis !== undefined ? { nis: d.nis?.trim() || null } : {}),
        ...(d.rib !== undefined ? { rib: d.rib?.trim() || null } : {}),
        ...(d.tierId !== undefined ? { tierId: d.tierId } : {}),
        ...(d.creditLimit !== undefined ? { creditLimit: d.creditLimit } : {}),
        ...(d.creditDays !== undefined ? { creditDays: d.creditDays } : {}),
        ...(d.gpsLat !== undefined ? { gpsLat: d.gpsLat } : {}),
        ...(d.gpsLng !== undefined ? { gpsLng: d.gpsLng } : {}),
        ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      },
    });
    return NextResponse.json(row);
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    if (d.legacyQr && await prisma.customer.findFirst({
      where: { companyId: session.companyId, legacyQr: d.legacyQr, id: { not: id } },
      select: { id: true },
    })) return NextResponse.json({ error: "duplicate_legacy_qr" }, { status: 409 });
    return NextResponse.json({ error: "duplicate_phone" }, { status: 409 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await prisma.customer.findFirst({ where: { id, companyId: session.companyId } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (Number(existing.balance) !== 0) {
    await prisma.customer.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({ ok: true, deactivated: true });
  }
  await prisma.customer.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
