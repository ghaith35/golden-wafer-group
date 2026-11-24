import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { clientSchema, generatePortalSecret } from "@/lib/clients/validation";
import { nextDocNumber } from "@/lib/docs/sequences";
import { checkClientArea } from "@/lib/users/area-scope";
import { loadAreaScope } from "@/lib/users/area-scope.server";
import { addClientToDayTour } from "@/lib/livreur/day-access";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim();
  const secteurId = sp.get("secteurId");
  const wilayaCode = sp.get("wilayaCode");
  const rows = await prisma.customer.findMany({
    where: {
      companyId: session.companyId,
      ...(secteurId ? { secteurId } : {}),
      ...(wilayaCode ? { wilayaCode: Number(wilayaCode) } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { code: { contains: q } }, { phone: { contains: q } }] } : {}),
    },
    include: { tier: true, secteur: true, wilaya: true },
    orderBy: { name: "asc" },
    take: 300,
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = clientSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  const d = parsed.data;

  // Tier assigned at creation: default to the first active tier.
  let tierId = d.tierId ?? null;
  if (tierId) {
    const tier = await prisma.priceTier.findFirst({ where: { id: tierId, companyId: session.companyId } });
    if (!tier) return NextResponse.json({ error: "bad_tier" }, { status: 400 });
  } else {
    const first = await prisma.priceTier.findFirst({
      where: { companyId: session.companyId, isActive: true },
      orderBy: { sortOrder: "asc" },
    });
    tierId = first?.id ?? null;
  }
  if (d.secteurId) {
    const sec = await prisma.secteur.findFirst({ where: { id: d.secteurId, companyId: session.companyId } });
    if (!sec) return NextResponse.json({ error: "bad_secteur" }, { status: 400 });
  }
  // Admin-assigned zones: a livreur / pré-vendeur with an assignment can only
  // create clients inside it (no assignment = everything, admins unrestricted).
  const scope = await loadAreaScope(session.userId, session.role);
  if (scope) {
    const secteurs = await prisma.secteur.findMany({ where: { companyId: session.companyId }, select: { id: true, wilayaCode: true } });
    const area = checkClientArea(scope, d, secteurs);
    if (!area.ok) return NextResponse.json({ error: area.error }, { status: 403 });
  }

  const secret = generatePortalSecret();
  const minted = d.code?.trim() || null;
  // Sequential numbers race under concurrency (read-then-write): retry once
  // with a fresh number. Phone-minted codes never retry (their QR is final).
  for (let attempt = 0; attempt < 2; attempt++) {
  try {
    const row = await prisma.$transaction(async (tx) => {
      // Phone-minted code (offline QR): honor when free; else sequential.
      let code = minted;
      if (code) {
        const taken = await tx.customer.findFirst({ where: { companyId: session.companyId, code } });
        if (taken) throw Object.assign(new Error("duplicate_code"), { status: 409 });
      } else {
        code = await nextDocNumber(tx, session.companyId, "client", 0, "CLT");
      }
      return tx.customer.create({
        data: {
          companyId: session.companyId,
          code,
          name: d.name.trim(),
          phone: d.phone?.trim() || null,
          address: d.address?.trim() || null,
          wilayaCode: d.wilayaCode ?? null,
          secteurId: d.secteurId ?? null,
          activityType: d.activityType?.trim() || null,
          rc: d.rc?.trim() || null,
          ai: d.ai?.trim() || null,
          nif: d.nif?.trim() || null,
          nis: d.nis?.trim() || null,
          rib: d.rib?.trim() || null,
          tierId,
          creditLimit: d.creditLimit ?? 0,
          creditDays: d.creditDays ?? 0,
          gpsLat: d.gpsLat ?? null,
          gpsLng: d.gpsLng ?? null,
          portalSecretHash: await bcrypt.hash(secret, 10),
          isActive: d.isActive ?? true,
          createdById: session.userId,
        },
        include: { tier: true, secteur: true, wilaya: true },
      });
    });
    await addClientToDayTour(session, row.id, raw?.day);
    return NextResponse.json({ ...row, portalSecret: secret }, { status: 201 });
  } catch (e) {
    const msg = String(e);
    if (!minted && msg.includes("customers_companyId_code_key") && attempt === 0) continue;
    if (msg.includes("customers_companyId_phone_key")) {
      return NextResponse.json({ error: "duplicate_phone" }, { status: 409 });
    }
    if (msg.includes("duplicate_code")) {
      return NextResponse.json({ error: "duplicate_code" }, { status: 409 });
    }
    throw e;
  }
  }
  return NextResponse.json({ error: "save_failed" }, { status: 500 });
}
