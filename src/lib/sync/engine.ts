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
import { getApkMeta, getMinNativeVersion, getWebBuildId, isForceWebUpdate } from "@/lib/update-feed";

type SyncInput = z.infer<typeof syncSchema>;
type OpResult = { opId: string; ok: boolean; id?: string; error?: string; permanent?: boolean };

/// Apply order: dependencies first (client before its ticket/order), then
/// movements, then day stamps. Stable within a kind (preserves outbox order).
const KIND_PRIORITY: Record<string, number> = {
  client: 0,
  "day-start": 1,
  ticket: 2,
  order: 2,
  "client-return": 2,
  "transfer-declare": 3,
  "transfer-confirm": 4,
  versement: 5,
  "cash-declare": 6,
  "stop-update": 7,
  "day-finish": 8,
};

function sortOps<T extends { kind: string }>(ops: T[]): T[] {
  return ops
    .map((op, i) => ({ op, i }))
    .sort((a, b) => (KIND_PRIORITY[a.op.kind] ?? 99) - (KIND_PRIORITY[b.op.kind] ?? 99) || a.i - b.i)
    .map((x) => x.op);
}

/// Prisma unique-constraint violation (P2002) — our exactly-once signal.
function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  if (err?.code === "P2002") return true;
  return /unique constraint|UNIQUE constraint/i.test(err?.message ?? "");
}

/// Fetch the document already created by this opId (after a unique collision).
async function existingByOpId(companyId: string, kind: string, opId: string): Promise<string | null> {
  switch (kind) {
    case "ticket":
    case "order": {
      const r = await prisma.sale.findFirst({ where: { companyId, opId }, select: { id: true } });
      return r?.id ?? null;
    }
    case "client": {
      const r = await prisma.customer.findFirst({ where: { companyId, opId }, select: { id: true } });
      return r?.id ?? null;
    }
    case "versement": {
      const r = await prisma.versement.findFirst({ where: { companyId, opId }, select: { id: true } });
      return r?.id ?? null;
    }
    case "client-return": {
      const r = await prisma.clientReturn.findFirst({ where: { companyId, opId }, select: { id: true } });
      return r?.id ?? null;
    }
    case "transfer-declare": {
      const r = await prisma.transfer.findFirst({ where: { companyId, opId }, select: { id: true } });
      return r?.id ?? null;
    }
    default:
      return null;
  }
}

/// Resolve the op's real action time (phone clock) with sane bounds, so a
/// wrong device clock can't move a sale to next month. Falls back to now.
function resolveOccurredAt(raw: unknown): Date {
  const now = Date.now();
  if (typeof raw !== "number" || !Number.isFinite(raw)) return new Date();
  const t = Math.trunc(raw);
  const FIVE_MIN = 5 * 60 * 1000;
  const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
  if (t > now + FIVE_MIN) return new Date(now);
  if (t < now - NINETY_DAYS) return new Date(now);
  return new Date(t);
}

async function applyOp(
  companyId: string,
  deviceId: string,
  userId: string,
  vanId: string | null,
  op: { opId: string; kind: string; payload: Record<string, unknown>; occurredAt?: number },
): Promise<OpResult> {
  const done = await prisma.syncOp.findUnique({ where: { companyId_opId: { companyId, opId: op.opId } } });
  if (done) {
    return done.status === "APPLIED"
      ? { opId: op.opId, ok: true, id: done.resultId ?? undefined }
      : { opId: op.opId, ok: false, error: done.error ?? "failed", permanent: true };
  }
  const occurredAt = resolveOccurredAt(op.occurredAt);
  try {
    let id: string | undefined;
    const p = op.payload;
    if (op.kind === "ticket") {
      const row = await createTicket(
        companyId,
        userId,
        {
          clientId: (p.clientId as string) ?? null,
          locationId: ((p.locationId as string) ?? vanId) as string,
          tierId: (p.tierId as string) ?? null,
          channel: (p.channel as "VAN" | "POS" | "DEPOT") ?? "VAN",
          qrScanned: Boolean(p.qrScanned),
          tourneeId: (p.tourneeId as string) ?? null,
          remise: Number(p.remise ?? 0),
          paid: p.paid == null ? null : Number(p.paid),
          notes: (p.notes as string) ?? null,
          lines: p.lines as never,
        },
        { opId: op.opId, occurredAt },
      );
      id = row.id;
    } else if (op.kind === "order") {
      // Bon de commande from the van: lands as DRAFT ORDER attributed to the
      // van (locationId) so the admin sees whose vendeur took it.
      const row = await createOrder(
        companyId,
        {
          clientId: p.clientId as string,
          tierId: (p.tierId as string) ?? null,
          locationId: ((p.locationId as string) ?? vanId) as string | undefined,
          channel: (p.channel as "VAN" | "POS" | "DEPOT") ?? "VAN",
          tourneeId: (p.tourneeId as string) ?? null,
          remise: Number(p.remise ?? 0),
          paid: p.paid == null ? 0 : Number(p.paid),
          notes: (p.notes as string) ?? null,
          lines: p.lines as never,
        },
        { createdBy: userId, opId: op.opId, occurredAt },
      );
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
            opId: op.opId,
          },
        });
      });
      id = row.id;
    } else if (op.kind === "versement") {
      // Client (or supplier) payment collected offline. Company-scoped:
      // the party MUST belong to this company.
      const kind = (p.kind as string) === "SUPPLIER_PAYMENT" ? "SUPPLIER_PAYMENT" : "CLIENT_PAYMENT";
      const amount = Number(p.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw Object.assign(new Error("bad_amount"), { status: 400 });
      const season = await ensureSeasonFor(companyId, occurredAt);
      if (kind === "CLIENT_PAYMENT") {
        const clientId = p.clientId as string;
        const client = await prisma.customer.findFirst({ where: { id: clientId, companyId }, select: { id: true } });
        if (!client) throw Object.assign(new Error("bad_client"), { status: 400 });
        id = await prisma.$transaction(async (tx) => {
          const v = await tx.versement.create({
            data: { companyId, seasonId: season.id, kind, clientId: client.id, amount, date: occurredAt, notes: (p.notes as string) ?? null, locationId: vanId ?? null, opId: op.opId },
          });
          await tx.customer.update({ where: { id: client.id }, data: { balance: { decrement: amount } } });
          return v.id;
        });
      } else {
        const supplierId = p.supplierId as string;
        const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, companyId }, select: { id: true } });
        if (!supplier) throw Object.assign(new Error("bad_supplier"), { status: 400 });
        id = await prisma.$transaction(async (tx) => {
          const v = await tx.versement.create({
            data: { companyId, seasonId: season.id, kind, supplierId: supplier.id, amount, date: occurredAt, notes: (p.notes as string) ?? null, locationId: vanId ?? null, opId: op.opId },
          });
          await tx.supplier.update({ where: { id: supplier.id }, data: { balance: { decrement: amount } } });
          return v.id;
        });
      }
    } else if (op.kind === "day-start" || op.kind === "day-finish") {
      // Offline day stamps: applied with the device owner's role.
      const { startDay, finishDay } = await import("@/lib/tournees/service");
      const staffer = await prisma.user.findFirst({ where: { id: userId, companyId }, select: { role: true } });
      const row = op.kind === "day-start"
        ? await startDay(companyId, userId, staffer?.role ?? "Vendeur", p.tourneeId as string, occurredAt)
        : await finishDay(companyId, userId, staffer?.role ?? "Vendeur", p.tourneeId as string, occurredAt);
      id = row.id;
    } else if (op.kind === "cash-declare") {
      // Offline till declaration: lands as DECLARED unless already closed.
      const { declareCash } = await import("@/lib/cash/daily");
      const staffer = await prisma.user.findFirst({ where: { id: userId, companyId }, select: { role: true } });
      const row = await declareCash(
        companyId, userId, staffer?.role ?? "Vendeur",
        (p.vanId as string) ?? vanId ?? "",
        p.dateIso as string, Number(p.amount), (p.notes as string) ?? null
      );
      id = row.id;
    } else if (op.kind === "client-return") {
      const { createClientReturn } = await import("@/lib/sales/service");
      const row = await createClientReturn(
        companyId,
        {
          clientId: p.clientId as string,
          saleId: (p.saleId as string) ?? null,
          locationId: ((p.locationId as string) ?? vanId) as string,
          refundType: (p.refundType as "CASH" | "DEBT_CREDIT") ?? "DEBT_CREDIT",
          notes: (p.notes as string) ?? null,
          lines: p.lines as never,
        },
        { opId: op.opId, occurredAt },
      );
      id = row.id;
    } else if (op.kind === "transfer-declare") {
      const row = await declareTransfer(
        companyId,
        userId,
        {
          fromLocationId: ((p.fromLocationId as string) ?? vanId) as string,
          toLocationId: p.toLocationId as string,
          cashAmount: Number(p.cashAmount ?? 0),
          notes: (p.notes as string) ?? null,
          lines: p.lines as never,
        },
        { opId: op.opId, occurredAt },
      );
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
    await prisma.syncOp.create({
      data: { companyId, deviceId, opId: op.opId, kind: op.kind, status: "APPLIED", resultId: id ?? null, occurredAt },
    }).catch((e) => {
      // Concurrent attempt already recorded it — that's fine.
      if (!isUniqueViolation(e)) throw e;
    });
    return { opId: op.opId, ok: true, id };
  } catch (e) {
    // A unique collision on the entity's opId means a concurrent/earlier
    // attempt already created the document → exactly-once, treat as success.
    if (isUniqueViolation(e)) {
      const existing = await existingByOpId(companyId, op.kind, op.opId);
      if (existing) {
        await prisma.syncOp.create({
          data: { companyId, deviceId, opId: op.opId, kind: op.kind, status: "APPLIED", resultId: existing, occurredAt },
        }).catch(() => {});
        return { opId: op.opId, ok: true, id: existing };
      }
    }
    const err = e as Error & { status?: number };
    const permanent = typeof err.status === "number" && err.status >= 400 && err.status < 500;
    await prisma.syncOp.create({
      data: { companyId, deviceId, opId: op.opId, kind: op.kind, status: "FAILED", error: err.message.slice(0, 500), occurredAt },
    }).catch(() => {});
    return { opId: op.opId, ok: false, error: err.message, permanent };
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

  // Dependency-ordered application (client before its ticket, etc.).
  const ordered = sortOps(input.ops ?? []);
  const applied: OpResult[] = [];
  for (const op of ordered) {
    applied.push(await applyOp(companyId, device.id, userId, vanId, op));
  }

  // Pull: everything the van needs to keep selling offline.
  // Pré-vendeur: depot stock (to promise commandes) · Livreur: own van
  // batches + held-for-commandes + assigned confirmed orders to deliver.
  // First sync seeds the whole offline catalog: products (+categories,
  // packs, tier prices, photos), clients, secteurs/wilayas, both stocks.
  // No silent caps — completeness matters more than payload size here.
  const [products, units, tiers, categories, secteurs, wilayas, clients, batches, depotBatches, transfers, tournees, vans, assignedOrders, holds, company, webBuildId, apkMeta] = await Promise.all([
    prisma.product.findMany({
      where: { companyId, isActive: true },
      include: { images: { orderBy: { sortOrder: "asc" } }, tierPrices: true, conversions: { include: { unit: true } }, baseUnit: true },
      orderBy: { name: "asc" },
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
          orderBy: { date: "desc" },
          take: 200,
        })
      : [],
    vanId
      ? prisma.tournee.findMany({
          where: { companyId, locationId: vanId, status: "OPEN" },
          include: { stops: { include: { client: { select: { id: true, name: true, code: true, gpsLat: true, gpsLng: true, tierId: true } } }, orderBy: { position: "asc" } } },
          orderBy: { date: "desc" },
          take: 30,
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
          take: 500,
        })
      : [],
    vanId ? vanHolds(companyId, vanId).then((h) => h.holds) : [],
    prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, phone: true, address: true, rc: true, nif: true, ai: true, logoUrl: true },
    }),
    getWebBuildId(),
    getApkMeta(),
  ]);

  await prisma.device.update({ where: { id: device.id }, data: { lastSyncAt: new Date(), ...(vanId ? { locationId: vanId } : {}) } });

  return {
    applied,
    serverTime: new Date().toISOString(),
    device: { id: device.id, locationId: vanId, binding: settings.vanBindingMode },
    pulled: {
      // Update channel: the phone compares webBuildId on every sync and
      // prompts for a one-tap web update (no APK reinstall for web changes).
      web: {
        buildId: webBuildId,
        minNative: getMinNativeVersion(),
        force: isForceWebUpdate(),
        apk: apkMeta,
      },
      settings: {
        remiseEnabled: settings.remiseEnabled,
        creditSalesEnabled: settings.creditSalesEnabled,
        qrStrictMode: settings.qrStrictMode,
        oversellAllowed: settings.oversellAllowed,
        expiryEnabled: settings.expiryEnabled,
        transferConfirmRequired: settings.transferConfirmRequired,
        pieceSalesEnabled: settings.pieceSalesEnabled,
        debtTrackingEnabled: settings.debtTrackingEnabled,
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
