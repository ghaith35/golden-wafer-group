import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getOrCreateSettings } from "@/lib/settings/helpers";
import { createOrder, createTicket } from "@/lib/sales/service";
import { clientSchema, generatePortalSecret } from "@/lib/clients/validation";
import { vanHolds } from "@/lib/holds";
import { nextDocNumber } from "@/lib/docs/sequences";
import { declareTransfer } from "@/lib/inventory/service";
import { updateStop } from "@/lib/tournees/service";
import { ensureSeasonFor } from "@/lib/docs/sequences";
import { z } from "zod";
import { syncSchema } from "@/lib/sync/validation";

type SyncInput = z.infer<typeof syncSchema>;
type OpResult = { opId: string; ok: boolean; id?: string; error?: string };

async function applyOp(
  companyId: string,
  deviceId: string,
  userId: string,
  vanId: string | null,
  op: { opId: string; kind: string; payload: Record<string, unknown> },
): Promise<OpResult> {
  const done = await prisma.syncOp.findUnique({ where: { companyId_opId: { companyId, opId: op.opId } } });
  if (done) {
    return done.status === "APPLIED"
      ? { opId: op.opId, ok: true }
      : { opId: op.opId, ok: false, error: done.error ?? "failed" };
  }
  try {
    let id: string | undefined;
    const p = op.payload;
    if (op.kind === "ticket") {
      const row = await createTicket(companyId, userId, {
        clientId: (p.clientId as string) ?? null,
        locationId: ((p.locationId as string) ?? vanId) as string,
        tierId: (p.tierId as string) ?? null,
        channel: "VAN",
        qrScanned: Boolean(p.qrScanned),
        tourneeId: (p.tourneeId as string) ?? null,
        remise: Number(p.remise ?? 0),
        paid: p.paid == null ? null : Number(p.paid),
        notes: (p.notes as string) ?? null,
        lines: p.lines as never,
      });
      id = row.id;
    } else if (op.kind === "order") {
      // Bon de commande from the van: lands as DRAFT ORDER attributed to the
      // van (locationId) so the admin sees whose vendeur took it.
      const { createOrder } = await import("@/lib/sales/service");
      const row = await createOrder(companyId, {
        clientId: p.clientId as string,
        tierId: (p.tierId as string) ?? null,
        locationId: ((p.locationId as string) ?? vanId) as string | undefined,
        channel: "VAN",
        tourneeId: (p.tourneeId as string) ?? null,
        remise: Number(p.remise ?? 0),
        paid: p.paid == null ? 0 : Number(p.paid),
        notes: (p.notes as string) ?? null,
        lines: p.lines as never,
      }, { createdBy: userId });
      id = row.id;
    } else if (op.kind === "client") {
      // New client created on the van: same rules as POST /api/clients.
      const parsed = clientSchema.safeParse(p);
      if (!parsed.success) throw Object.assign(new Error("validation_error"), { status: 400 });
      const d = parsed.data;
      let tierId = d.tierId ?? null;
      if (tierId) {
        const tier = await prisma.priceTier.findFirst({ where: { id: tierId, companyId } });
        if (!tier) throw Object.assign(new Error("bad_tier"), { status: 400 });
      } else {
        const first = await prisma.priceTier.findFirst({
          where: { companyId, isActive: true },
          orderBy: { sortOrder: "asc" },
        });
        tierId = first?.id ?? null;
      }
      if (d.secteurId) {
        const sec = await prisma.secteur.findFirst({ where: { id: d.secteurId, companyId } });
        if (!sec) throw Object.assign(new Error("bad_secteur"), { status: 400 });
      }
      const secret = generatePortalSecret();
      const row = await prisma.$transaction(async (tx) => {
        // Phone-minted code (offline QR printed at creation): honor it when
        // free so the synced account keeps the QR the client already holds.
        let code = d.code?.trim() || null;
        if (code) {
          const taken = await tx.customer.findFirst({ where: { companyId, code } });
          if (taken) throw Object.assign(new Error("duplicate_code"), { status: 409 });
        } else {
          code = await nextDocNumber(tx, companyId, "client", 0, "CLT");
        }
        return tx.customer.create({
          data: {
            companyId,
            code,
            name: d.name.trim(),
            phone: d.phone?.trim() || null,
            address: d.address?.trim() || null,
            wilayaCode: d.wilayaCode ?? null,
            secteurId: d.secteurId ?? null,
            activityType: d.activityType?.trim() || null,
            tierId,
            creditLimit: d.creditLimit ?? 0,
            creditDays: d.creditDays ?? 0,
            gpsLat: d.gpsLat ?? null,
            gpsLng: d.gpsLng ?? null,
            portalSecretHash: await bcrypt.hash(secret, 10),
            isActive: d.isActive ?? true,
          },
        });
      });
      id = row.id;
    } else if (op.kind === "versement") {
      const clientId = p.clientId as string;
      const amount = Number(p.amount);
      const date = new Date();
      const season = await ensureSeasonFor(companyId, date);
      id = await prisma.$transaction(async (tx) => {
        const v = await tx.versement.create({
          data: { companyId, seasonId: season.id, kind: "CLIENT_PAYMENT", clientId, amount, date, notes: (p.notes as string) ?? null, locationId: vanId ?? null },
        });
        await tx.customer.update({ where: { id: clientId }, data: { balance: { decrement: amount } } });
        return v.id;
      });
    } else if (op.kind === "cash-declare") {
      // Offline till declaration: lands as DECLARED unless already closed.
      const { declareCash } = await import("@/lib/cash/daily");
      const row = await declareCash(
        companyId, userId, "Vendeur",
        (p.vanId as string) ?? vanId ?? "",
        p.dateIso as string, Number(p.amount), (p.notes as string) ?? null
      );
      id = row.id;
    } else if (op.kind === "client-return") {
      const { createClientReturn } = await import("@/lib/sales/service");
      const row = await createClientReturn(companyId, {
        clientId: p.clientId as string,
        saleId: (p.saleId as string) ?? null,
        locationId: ((p.locationId as string) ?? vanId) as string,
        refundType: (p.refundType as "CASH" | "DEBT_CREDIT") ?? "DEBT_CREDIT",
        notes: (p.notes as string) ?? null,
        lines: p.lines as never,
      });
      id = row.id;
    } else if (op.kind === "transfer-declare") {
      const row = await declareTransfer(companyId, userId, {
        fromLocationId: ((p.fromLocationId as string) ?? vanId) as string,
        toLocationId: p.toLocationId as string,
        cashAmount: Number(p.cashAmount ?? 0),
        notes: (p.notes as string) ?? null,
        lines: p.lines as never,
      });
      id = row.id;
    } else if (op.kind === "transfer-confirm") {
      const { resolveTransfer } = await import("@/lib/inventory/service");
      const row = await resolveTransfer(companyId, userId, p.transferId as string, {
        action: "confirm",
        lines: Array.isArray(p.lines)
          ? (p.lines as Array<{ lineId: string; confirmedQty: number }>)
          : [],
      });
      id = row.id;
    } else if (op.kind === "stop-update") {
      const row = await updateStop(companyId, p.stopId as string, {
        visited: p.visited as boolean | undefined,
        sold: p.sold as boolean | undefined,
        skipped: p.skipped as boolean | undefined,
      });
      id = row.id;
    } else {
      throw Object.assign(new Error("bad_kind"), { status: 400 });
    }
    await prisma.syncOp.create({ data: { companyId, deviceId, opId: op.opId, kind: op.kind, status: "APPLIED" } });
    return { opId: op.opId, ok: true, id };
  } catch (e) {
    const err = e as Error;
    await prisma.syncOp.create({
      data: { companyId, deviceId, opId: op.opId, kind: op.kind, status: "FAILED", error: err.message.slice(0, 500) },
    });
    return { opId: op.opId, ok: false, error: err.message };
  }
}

export async function handleSync(input: SyncInput) {
  const tokenHash = crypto.createHash("sha256").update(input.deviceToken).digest("hex");
  const device = await prisma.device.findFirst({
    where: { tokenHash, isActive: true },
    include: { location: true, user: true },
  });
  if (!device) throw Object.assign(new Error("bad_device"), { status: 401 });
  const companyId = device.companyId;
  const settings = await getOrCreateSettings(companyId);

  // Van binding: LOCKED pins ops to the device van; PICK accepts the
  // request location and remembers it on the device.
  let vanId = device.locationId;
  if (settings.vanBindingMode === "PICK" && input.locationId) {
    const loc = await prisma.store.findFirst({ where: { id: input.locationId, companyId, kind: "VAN" } });
    if (!loc) throw Object.assign(new Error("bad_location"), { status: 400 });
    vanId = loc.id;
    await prisma.device.update({ where: { id: device.id }, data: { locationId: vanId } });
  }
  if (settings.vanBindingMode === "LOCKED" && !vanId) {
    throw Object.assign(new Error("device_unbound"), { status: 400 });
  }
  const userId = device.userId;
  if (!userId) throw Object.assign(new Error("device_no_user"), { status: 400 });

  const applied: OpResult[] = [];
  for (const op of input.ops ?? []) {
    applied.push(await applyOp(companyId, device.id, userId, vanId, op));
  }

  // Pull: everything the van needs to keep selling offline.
  // Pré-vendeur: depot stock (to promise commandes) · Livreur: own van
  // batches + held-for-commandes + assigned confirmed orders to deliver.
  // First sync seeds the whole offline catalog: products (+categories,
  // packs, tier prices, photos), clients, secteurs/wilayas, both stocks.
  const [products, units, tiers, categories, secteurs, wilayas, clients, batches, depotBatches, transfers, tournees, vans, assignedOrders, holds, company] = await Promise.all([
    prisma.product.findMany({
      where: { companyId, isActive: true },
      include: { images: { orderBy: { sortOrder: "asc" } }, tierPrices: true, conversions: { include: { unit: true } }, baseUnit: true },
      orderBy: { name: "asc" },
      take: 1000,
    }),
    prisma.unit.findMany({ where: { companyId, isActive: true } }),
    prisma.priceTier.findMany({ where: { companyId, isActive: true } }),
    prisma.productCategory.findMany({ where: { companyId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.secteur.findMany({ where: { companyId, isActive: true }, select: { id: true, name: true, wilayaCode: true }, orderBy: { name: "asc" } }),
    prisma.wilaya.findMany({ select: { code: true, nameAr: true, nameFr: true }, orderBy: { code: "asc" } }),
    prisma.customer.findMany({
      where: { companyId, isActive: true },
      select: {
        id: true, code: true, name: true, phone: true, address: true,
        wilayaCode: true, tierId: true, balance: true, creditLimit: true,
        secteurId: true, gpsLat: true, gpsLng: true,
      },
      take: 2000,
    }),
    vanId
      ? prisma.stockBatch.groupBy({
          by: ["productId"],
          where: { companyId, storeId: vanId, transferId: null, qty: { gt: 0 } },
          _sum: { qty: true },
        })
      : [],
    prisma.stockBatch.groupBy({
      by: ["productId"],
      where: { companyId, transferId: null, location: { kind: "DEPOT" } },
      _sum: { qty: true },
    }),
    vanId
      ? prisma.transfer.findMany({
          where: { companyId, status: "DECLARED", OR: [{ fromLocationId: vanId }, { toLocationId: vanId }] },
          include: { lines: { include: { product: { select: { id: true, name: true } } } }, fromLocation: { select: { name: true } }, toLocation: { select: { name: true } } },
          take: 50,
        })
      : [],
    vanId
      ? prisma.tournee.findMany({
          where: { companyId, locationId: vanId, status: "OPEN" },
          include: { stops: { include: { client: { select: { id: true, name: true, code: true, gpsLat: true, gpsLng: true, tierId: true } } }, orderBy: { position: "asc" } } },
          orderBy: { date: "desc" },
          take: 10,
        })
      : [],
    prisma.store.findMany({ where: { companyId, kind: "VAN", isActive: true }, select: { id: true, name: true, matricule: true } }),
    vanId
      ? prisma.sale.findMany({
          where: { companyId, kind: "ORDER", status: "CONFIRMED", locationId: vanId },
          include: {
            client: { select: { id: true, name: true, code: true, phone: true, address: true, gpsLat: true, gpsLng: true } },
            lines: { include: { product: { select: { id: true, name: true, baseUnitId: true } } } },
          },
          orderBy: { createdAt: "asc" },
          take: 100,
        })
      : [],
    vanId ? vanHolds(companyId, vanId).then((h) => h.holds) : [],
    prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, phone: true, address: true, rc: true, nif: true, ai: true, logoUrl: true },
    }),
  ]);

  await prisma.device.update({ where: { id: device.id }, data: { lastSyncAt: new Date(), ...(vanId ? { locationId: vanId } : {}) } });

  return {
    applied,
    serverTime: new Date().toISOString(),
    device: { id: device.id, locationId: vanId, binding: settings.vanBindingMode },
    pulled: {
      settings: {
        remiseEnabled: settings.remiseEnabled,
        creditSalesEnabled: settings.creditSalesEnabled,
        qrStrictMode: settings.qrStrictMode,
        oversellAllowed: settings.oversellAllowed,
        expiryEnabled: settings.expiryEnabled,
        transferConfirmRequired: settings.transferConfirmRequired,
        pieceSalesEnabled: settings.pieceSalesEnabled,
      },
      company: company
        ? {
            name: company.name,
            phone: company.phone,
            address: company.address,
            rc: company.rc,
            nif: company.nif,
            ai: company.ai,
            logoUrl: company.logoUrl,
          }
        : null,
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        reference: p.reference,
        barcode: p.barcode,
        colisage: p.colisage,
        salePrice: Number(p.salePrice),
        categoryId: (p as { categoryId?: string | null }).categoryId ?? null,
        images: p.images.map((i) => i.url),
        baseUnit: p.baseUnit ? { id: p.baseUnit.id, name: p.baseUnit.name } : null,
        conversions: p.conversions.map((c) => ({ unitId: c.unitId, name: c.unit.name, factor: Number(c.factor), barcode: c.barcode })),
        tierPrices: p.tierPrices.map((x) => ({ tierId: x.tierId, price: Number(x.price) })),
      })),
      units,
      tiers,
      categories,
      secteurs,
      wilayas,
      clients: clients.map((c) => ({
        ...c,
        balance: Number(c.balance ?? 0),
        creditLimit: Number(c.creditLimit ?? 0),
      })),
      stock: batches.map((b) => ({ productId: b.productId, qty: Number(b._sum.qty ?? 0) })),
      depotStock: depotBatches.map((b) => ({ productId: b.productId, qty: Number(b._sum.qty ?? 0) })),
      holds,
      assignedOrders,
      transfers,
      tournees,
      vans,
    },
  };
}
