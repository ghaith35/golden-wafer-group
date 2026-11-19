import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getOrCreateSettings } from "@/lib/settings/helpers";
import { createOrder, createTicket } from "@/lib/sales/service";
import { clientSchema, generatePortalSecret, legacyQrSchema } from "@/lib/clients/validation";
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
  "client-update": 1,
  "day-start": 1,
  ticket: 2,
  order: 2,
  "order-deliver": 2,
  "sale-cancel": 2,
  "sale-reopen": 2,
  "client-return": 2,
  "transfer-declare": 3,
  "transfer-confirm": 4,
  "transfer-reject": 4,
  versement: 5,
  expense: 5,
  "expense-update": 5,
  "expense-delete": 5,
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
    case "expense": {
      const r = await prisma.expense.findFirst({ where: { companyId, opId }, select: { id: true } });
      return r?.id ?? null;
    }
    case "client-return": {
      const r = await prisma.clientReturn.findFirst({ where: { companyId, opId }, select: { id: true } });
      return r?.id ?? null;
    }
    case "order-deliver": {
      const r = await prisma.sale.findFirst({ where: { companyId, opId }, select: { id: true } });
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

/// Parse a user-picked YYYY-MM-DD expense day with sane bounds (same
/// 90-day past / 5-min future window as op timestamps). Garbage → null.
function validExpenseDay(raw: unknown): Date | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const now = Date.now();
  if (d.getTime() > now + 5 * 60 * 1000) return new Date(now);
  if (d.getTime() < now - 90 * 24 * 60 * 60 * 1000) return new Date(now);
  return d;
}

/// Find the van's OPEN tour for the given day, creating it when the driver
/// started a day with no planned tour (offline start). One open tour per
/// van-day is enforced by createTournee; concurrent creates resolve to the
/// same row via the clash check.
async function ensureVanDayTournee(companyId: string, vanId: string, day: string | Date): Promise<string> {
  if (!vanId) throw Object.assign(new Error("bad_van"), { status: 400 });
  const d = day instanceof Date ? new Date(day) : new Date(String(day));
  if (Number.isNaN(d.getTime())) throw Object.assign(new Error("bad_date"), { status: 400 });
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  const end = new Date(s);
  end.setDate(end.getDate() + 1);
  const existing = await prisma.tournee.findFirst({
    where: { companyId, locationId: vanId, status: "OPEN", date: { gte: s, lt: end } },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing.id;
  const { createTournee } = await import("@/lib/tournees/service");
  try {
    const row = await createTournee(companyId, { date: s.toISOString(), locationId: vanId });
    return row.id;
  } catch (err) {
    // Lost a concurrent create race — take the winner's row.
    if ((err as Error)?.message === "duplicate_day") {
      const winner = await prisma.tournee.findFirst({
        where: { companyId, locationId: vanId, status: "OPEN", date: { gte: s, lt: end } },
        select: { id: true },
        orderBy: { createdAt: "desc" },
      });
      if (winner) return winner.id;
    }
    throw err;
  }
}

/// Resolve a client id from an offline op. Phones reference just-created
/// (still unsynced) clients as `pending:<opId>` — resolved here to the real
/// row created earlier in the SAME batch (client ops sort first), or to a
/// row from an earlier sync (same opId retried across syncs). Anything else
/// is a genuine bad reference and fails visibly for the owner to fix.
async function resolveClientId(
  companyId: string,
  raw: unknown,
  created: Map<string, string>,
): Promise<string | null> {
  if (raw == null) return null;
  const id = String(raw);
  if (!id.startsWith("pending:")) return id;
  const opId = id.slice("pending:".length);
  const live = created.get(opId);
  if (live) return live;
  const row = await prisma.customer.findFirst({ where: { companyId, opId }, select: { id: true } });
  if (row) return row.id;
  throw Object.assign(new Error("bad_client"), { status: 400 });
}

/// Till attribution for offline payments — mirrors POST /api/versements:
/// explicit payload location/tour wins (company-validated), else the device
/// van + that day's tour. Keeps the till journal consistent online/offline.
async function resolveTillAttribution(
  companyId: string,
  p: Record<string, unknown>,
  vanId: string | null,
  occurredAt: Date,
): Promise<{ locationId: string | null; tourneeId: string | null }> {
  let locationId = ((p.locationId as string) ?? vanId ?? null) as string | null;
  let tourneeId = ((p.tourneeId as string) ?? null) as string | null;
  if (locationId) {
    const loc = await prisma.store.findFirst({ where: { id: locationId, companyId }, select: { id: true } });
    if (!loc) throw Object.assign(new Error("bad_location"), { status: 400 });
  }
  if (tourneeId) {
    const t = await prisma.tournee.findFirst({ where: { id: tourneeId, companyId }, select: { id: true } });
    if (!t) throw Object.assign(new Error("bad_tournee"), { status: 400 });
  }
  if (locationId && !tourneeId) {
    const s = new Date(occurredAt);
    s.setHours(0, 0, 0, 0);
    const e = new Date(s);
    e.setDate(e.getDate() + 1);
    const tour = await prisma.tournee.findFirst({
      where: { companyId, locationId, date: { gte: s, lt: e } },
      select: { id: true },
    });
    tourneeId = tour?.id ?? null;
  }
  return { locationId, tourneeId };
}

async function applyOp(
  companyId: string,
  deviceId: string,
  userId: string,
  vanId: string | null,
  op: { opId: string; kind: string; payload: Record<string, unknown>; occurredAt?: number },
  created: Map<string, string>,
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
      // Mandob (Vendeur) never creates tickets — not even via offline replay.
      const staffer = await prisma.user.findFirst({ where: { id: userId, companyId }, select: { role: true } });
      if ((staffer?.role ?? "Vendeur") === "Vendeur") throw Object.assign(new Error("forbidden"), { status: 403 });
      const row = await createTicket(
        companyId,
        userId,
        {
          clientId: await resolveClientId(companyId, p.clientId, created),
          locationId: ((p.locationId as string) ?? vanId) as string,
          tierId: (p.tierId as string) ?? null,
          channel: (p.channel as "VAN" | "POS" | "DEPOT") ?? "VAN",
          qrScanned: Boolean(p.qrScanned),
          tourneeId: (p.tourneeId as string) ?? null,
          remise: Number(p.remise ?? 0),
          paid: p.paid == null ? null : Number(p.paid),
          notes: (p.notes as string) ?? null,
          saleLat: p.saleLat == null ? null : Number(p.saleLat),
          saleLng: p.saleLng == null ? null : Number(p.saleLng),
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
          clientId: (await resolveClientId(companyId, p.clientId, created)) as string,
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
            opId: op.opId,
          },
        });
      });
      id = row.id;
    } else if (op.kind === "client-update") {
      // Offline client edit: driver-safe fields ONLY (name/phone/address/
      // area/GPS/legacy QR). Financial fields (tier/credit/balance/code) are NEVER
      // taken from the payload — the phone cannot grant credit, change tiers
      // or rename codes. Pending-created clients resolve via the created map.
      const clientId = await resolveClientId(companyId, p.clientId, created);
      if (!clientId) throw Object.assign(new Error("bad_client"), { status: 400 });
      const target = await prisma.customer.findFirst({ where: { id: clientId, companyId }, select: { id: true } });
      if (!target) throw Object.assign(new Error("bad_client"), { status: 400 });
      const patch = (p.patch ?? {}) as Record<string, unknown>;
      const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
      const data: Record<string, unknown> = {};
      if (patch.name !== undefined) {
        const name = str(patch.name);
        if (!name) throw Object.assign(new Error("bad_name"), { status: 400 });
        data.name = name;
      }
      if (patch.phone !== undefined) data.phone = str(patch.phone) || null;
      if (patch.address !== undefined) data.address = str(patch.address) || null;
      if (patch.activityType !== undefined) data.activityType = str(patch.activityType) || null;
      if (patch.rc !== undefined) data.rc = str(patch.rc) || null;
      if (patch.ai !== undefined) data.ai = str(patch.ai) || null;
      if (patch.nif !== undefined) data.nif = str(patch.nif) || null;
      if (patch.nis !== undefined) data.nis = str(patch.nis) || null;
      if (patch.rib !== undefined) data.rib = str(patch.rib) || null;
      if (patch.wilayaCode !== undefined) {
        const w = Number(patch.wilayaCode);
        data.wilayaCode = Number.isFinite(w) ? Math.trunc(w) : null;
      }
      if (patch.secteurId !== undefined) {
        const sid = str(patch.secteurId);
        if (sid) {
          const sec = await prisma.secteur.findFirst({ where: { id: sid, companyId } });
          if (!sec) throw Object.assign(new Error("bad_secteur"), { status: 400 });
          data.secteurId = sid;
        } else {
          data.secteurId = null;
        }
      }
      if (patch.gpsLat !== undefined || patch.gpsLng !== undefined) {
        const la = Number(patch.gpsLat);
        const ln = Number(patch.gpsLng);
        data.gpsLat = Number.isFinite(la) ? la : null;
        data.gpsLng = Number.isFinite(ln) ? ln : null;
      }
      if (patch.legacyQr !== undefined) {
        const qr = legacyQrSchema.safeParse(patch.legacyQr);
        if (!qr.success) throw Object.assign(new Error("bad_legacy_qr"), { status: 400 });
        data.legacyQr = qr.data;
      }
      try {
        await prisma.customer.update({ where: { id: clientId }, data });
      } catch (e) {
        // Phone taken by another client meanwhile → FAILED (permanent,
        // visible in SyncModal with repair/discard), never silent.
        if (isUniqueViolation(e)) {
          const duplicateQr = typeof data.legacyQr === "string" && await prisma.customer.findFirst({
            where: { companyId, legacyQr: data.legacyQr, id: { not: clientId } },
            select: { id: true },
          });
          throw Object.assign(new Error(duplicateQr ? "duplicate_legacy_qr" : "duplicate_phone"), { status: 409 });
        }
        throw e;
      }
      id = clientId;
    } else if (op.kind === "versement") {
      // Client (or supplier) payment collected offline. Company-scoped:
      // the party MUST belong to this company.
      const kind = (p.kind as string) === "SUPPLIER_PAYMENT" ? "SUPPLIER_PAYMENT" : "CLIENT_PAYMENT";
      const amount = Number(p.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw Object.assign(new Error("bad_amount"), { status: 400 });
      const season = await ensureSeasonFor(companyId, occurredAt);
      if (kind === "CLIENT_PAYMENT") {
        const clientId = await resolveClientId(companyId, p.clientId, created);
        if (!clientId) throw Object.assign(new Error("bad_client"), { status: 400 });
        const client = await prisma.customer.findFirst({ where: { id: clientId, companyId }, select: { id: true } });
        if (!client) throw Object.assign(new Error("bad_client"), { status: 400 });
        const till = await resolveTillAttribution(companyId, p, vanId, occurredAt);
        id = await prisma.$transaction(async (tx) => {
          const v = await tx.versement.create({
            data: { companyId, seasonId: season.id, kind, clientId: client.id, amount, date: occurredAt, notes: (p.notes as string) ?? null, locationId: till.locationId, tourneeId: till.tourneeId, opId: op.opId },
          });
          await tx.customer.update({ where: { id: client.id }, data: { balance: { decrement: amount } } });
          return v.id;
        });
      } else {
        const supplierId = p.supplierId as string;
        const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, companyId }, select: { id: true } });
        if (!supplier) throw Object.assign(new Error("bad_supplier"), { status: 400 });
        const till = await resolveTillAttribution(companyId, p, vanId, occurredAt);
        id = await prisma.$transaction(async (tx) => {
          const v = await tx.versement.create({
            data: { companyId, seasonId: season.id, kind, supplierId: supplier.id, amount, date: occurredAt, notes: (p.notes as string) ?? null, locationId: till.locationId, tourneeId: till.tourneeId, opId: op.opId },
          });
          await tx.supplier.update({ where: { id: supplier.id }, data: { balance: { decrement: amount } } });
          return v.id;
        });
      }
    } else if (op.kind === "day-start" || op.kind === "day-finish") {
      // Offline day stamps: applied with the device owner's role.
      // day-start may carry {vanId, dateIso} instead of a tourneeId (the phone
      // had no planned tour): find-or-create the van's OPEN tour, then stamp.
      const { startDay, finishDay } = await import("@/lib/tournees/service");
      const staffer = await prisma.user.findFirst({ where: { id: userId, companyId }, select: { role: true } });
      let stampTourneeId = p.tourneeId as string | undefined;
      if (op.kind === "day-start" && !stampTourneeId) {
        stampTourneeId = await ensureVanDayTournee(companyId, ((p.vanId as string) ?? vanId) as string, (p.dateIso as string) ?? occurredAt);
      }
      const row = op.kind === "day-start"
        ? await startDay(companyId, userId, staffer?.role ?? "Vendeur", stampTourneeId as string, occurredAt, { lat: p.lat, lng: p.lng })
        : await finishDay(companyId, userId, staffer?.role ?? "Vendeur", stampTourneeId as string, occurredAt, { lat: p.lat, lng: p.lng });
      id = row.id;
    } else if (op.kind === "cash-declare") {
      // Offline till declaration: lands as DECLARED unless already closed.
      // The day row is derived from the REAL action time (occurredAt), never
      // the phone's wall-clock date string — a wrong device date must not
      // file the declaration under the wrong day.
      const { declareCash } = await import("@/lib/cash/daily");
      const staffer = await prisma.user.findFirst({ where: { id: userId, companyId }, select: { role: true } });
      const iso = `${occurredAt.getFullYear()}-${String(occurredAt.getMonth() + 1).padStart(2, "0")}-${String(occurredAt.getDate()).padStart(2, "0")}`;
      const row = await declareCash(
        companyId, userId, staffer?.role ?? "Vendeur",
        (p.vanId as string) ?? vanId ?? "",
        iso, Number(p.amount), (p.notes as string) ?? null
      );
      id = row.id;
    } else if (op.kind === "expense") {
      // Van expense entered on the phone (fuel…): lands in company expenses
      // with the van link, so it shows in the logiciel + the day till math.
      const amount = Number(p.amount);
      const label = String(p.label ?? "").trim();
      if (!Number.isFinite(amount) || amount <= 0) throw Object.assign(new Error("bad_amount"), { status: 400 });
      if (!label) throw Object.assign(new Error("bad_label"), { status: 400 });
      const season = await ensureSeasonFor(companyId, occurredAt);
      const vanLoc = ((p.vanId as string) ?? vanId) as string | null;
      if (vanLoc) {
        const loc = await prisma.store.findFirst({ where: { id: vanLoc, companyId }, select: { id: true } });
        if (!loc) throw Object.assign(new Error("bad_location"), { status: 400 });
      }
      const row = await prisma.expense.create({
        data: {
          companyId, seasonId: season.id,
          locationId: vanLoc ?? null,
          label: label.slice(0, 120),
          description: typeof p.notes === "string" && p.notes.trim() ? p.notes.trim().slice(0, 500) : null,
          amount,
          expenseDate: validExpenseDay(p.expenseDate) ?? occurredAt,
          opId: op.opId,
        },
      });
      id = row.id;
    } else if (op.kind === "expense-update" || op.kind === "expense-delete") {
      // Offline edit / soft-delete of a van expense. The row is found by
      // server id (synced rows) or by the create opId (rows still unsynced
      // when the follow-up op was queued). Non-admin may only touch their
      // OWN van's rows — same rule as the online PATCH/DELETE routes.
      const staffer = await prisma.user.findFirst({ where: { id: userId, companyId }, select: { role: true } });
      let ownVan: string | null = null;
      if ((staffer?.role ?? "Vendeur") !== "Admin") {
        const v = await prisma.store.findFirst({ where: { companyId, kind: "VAN", userId }, select: { id: true } });
        if (!v) throw Object.assign(new Error("no_van"), { status: 400 });
        ownVan = v.id;
      }
      const ref = typeof p.ref === "string" && p.ref ? p.ref : null;
      const opRef = typeof p.opRef === "string" && p.opRef ? p.opRef : null;
      const target = ref
        ? await prisma.expense.findFirst({ where: { id: ref, companyId } })
        : opRef
          ? await prisma.expense.findFirst({ where: { companyId, opId: opRef } })
          : null;
      if (!target) throw Object.assign(new Error("not_found"), { status: 404 });
      if (ownVan && target.locationId !== ownVan) throw Object.assign(new Error("forbidden"), { status: 403 });
      if (op.kind === "expense-delete") {
        if (!target.deletedAt) {
          await prisma.expense.update({ where: { id: target.id }, data: { deletedAt: occurredAt } });
        }
      } else {
        const patch: { label?: string; amount?: number; expenseDate?: Date } = {};
        if (typeof p.label === "string" && p.label.trim()) patch.label = p.label.trim().slice(0, 120);
        if (p.amount != null) {
          const a = Number(p.amount);
          if (!Number.isFinite(a) || a <= 0) throw Object.assign(new Error("bad_amount"), { status: 400 });
          patch.amount = a;
        }
        const day = validExpenseDay(p.expenseDate);
        if (day) patch.expenseDate = day;
        if (!Object.keys(patch).length) throw Object.assign(new Error("bad_fields"), { status: 400 });
        await prisma.expense.update({ where: { id: target.id }, data: patch });
      }
      id = target.id;
    } else if (op.kind === "order-deliver") {
      // Offline delivery of a confirmed order (+ cash collected on the spot).
      // deliverOrder guards the state (CONFIRMED only) so a double delivery
      // surfaces as a failed op for the owner instead of duplicating stock.
      const { deliverOrder } = await import("@/lib/sales/service");
      const saleId = p.saleId as string;
      if (!saleId) throw Object.assign(new Error("bad_sale"), { status: 400 });
      const target = await prisma.sale.findFirst({ where: { id: saleId, companyId }, select: { id: true, status: true, kind: true } });
      if (!target) throw Object.assign(new Error("not_found"), { status: 404 });
      if (target.kind !== "ORDER") throw Object.assign(new Error("bad_kind"), { status: 400 });
      if (target.status === "DELIVERED") {
        // Already delivered (e.g. online first, op replayed): success, link it.
        const child = await prisma.sale.findFirst({ where: { companyId, sourceId: saleId }, select: { id: true }, orderBy: { createdAt: "desc" } });
        id = child?.id;
        if (!id) throw Object.assign(new Error("bad_status"), { status: 400 });
      } else {
        const row = await deliverOrder(
          companyId, saleId,
          ((p.locationId as string) ?? vanId) as string,
          Number(p.paid ?? 0),
          { opId: op.opId, at: occurredAt },
        );
        id = row.id;
      }
    } else if (op.kind === "sale-cancel") {
      // Offline cancellation: reverses stock + debt like the online button.
      // Already-cancelled → success (idempotent replay).
      // Mandob (Vendeur) has no facture actions — not via replay either.
      const canceller = await prisma.user.findFirst({ where: { id: userId, companyId }, select: { role: true } });
      if ((canceller?.role ?? "Vendeur") === "Vendeur") throw Object.assign(new Error("forbidden"), { status: 403 });
      const { cancelSale } = await import("@/lib/sales/service");
      const saleId = p.saleId as string;
      if (!saleId) throw Object.assign(new Error("bad_sale"), { status: 400 });
      const target = await prisma.sale.findFirst({ where: { id: saleId, companyId }, select: { id: true, status: true } });
      if (!target) throw Object.assign(new Error("not_found"), { status: 404 });
      if (target.status !== "CANCELLED") await cancelSale(companyId, saleId);
      id = saleId;
    } else if (op.kind === "sale-reopen") {
      // Offline redelivery fix: reopen a DELIVERED order back to CONFIRMED.
      // Already open → success (idempotent replay).
      // Mandob (Vendeur) has no facture actions — not via replay either.
      const reopener = await prisma.user.findFirst({ where: { id: userId, companyId }, select: { role: true } });
      if ((reopener?.role ?? "Vendeur") === "Vendeur") throw Object.assign(new Error("forbidden"), { status: 403 });
      const { reopenOrder } = await import("@/lib/sales/service");
      const saleId = p.saleId as string;
      if (!saleId) throw Object.assign(new Error("bad_sale"), { status: 400 });
      const target = await prisma.sale.findFirst({ where: { id: saleId, companyId }, select: { id: true, status: true, kind: true } });
      if (!target) throw Object.assign(new Error("not_found"), { status: 404 });
      if (target.kind !== "ORDER") throw Object.assign(new Error("bad_kind"), { status: 400 });
      if (target.status !== "DELIVERED") {
        if (target.status !== "CONFIRMED") throw Object.assign(new Error("bad_status"), { status: 400 });
      } else {
        await reopenOrder(companyId, saleId);
      }
      id = saleId;
    } else if (op.kind === "client-return") {
      const { createClientReturn } = await import("@/lib/sales/service");
      const row = await createClientReturn(
        companyId,
        {
          clientId: (await resolveClientId(companyId, p.clientId, created)) as string,
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
      // Restock requests are livreur-only: a Vendeur declares nothing
      // (UI hides the section; the proxy bounces the page; this is the
      // last gate before stock moves).
      const declarer = await prisma.user.findFirst({ where: { id: userId, companyId }, select: { role: true } });
      if ((declarer?.role ?? "Vendeur") === "Vendeur") throw Object.assign(new Error("forbidden"), { status: 403 });
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
    } else if (op.kind === "transfer-reject") {
      // Offline refusal/cancellation: holdings flow back like online.
      // Non-DECLARED at apply time surfaces as a failed op for the owner.
      const { resolveTransfer } = await import("@/lib/inventory/service");
      const action = p.action === "cancel" ? "cancel" : "reject";
      const row = await resolveTransfer(companyId, userId, p.transferId as string, { action });
      id = row.id;
    } else if (op.kind === "stop-update") {
      // A driver may only tick his OWN van's stops (Admin bypasses).
      const staffer = await prisma.user.findFirst({ where: { id: userId, companyId }, select: { role: true } });
      if ((staffer?.role ?? "Vendeur") !== "Admin" && vanId) {
        const stop = await prisma.tourneeStop.findFirst({
          where: { id: p.stopId as string, tournee: { companyId, locationId: vanId } },
          select: { id: true },
        });
        if (!stop) throw Object.assign(new Error("forbidden"), { status: 403 });
      }
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
  // Revoked phone or deactivated driver: refuse everything (the phone wipes
  // its offline credential on these errors and forces an online login).
  const deviceUser = (device as { user?: { isActive?: boolean } | null }).user;
  if (deviceUser && deviceUser.isActive === false) {
    throw Object.assign(new Error("user_inactive"), { status: 401 });
  }
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
  // opId → created customer id within THIS batch (pending: resolution).
  const created = new Map<string, string>();
  for (const op of ordered) {
    const r = await applyOp(companyId, device.id, userId, vanId, op, created);
    if (r.ok && r.id && op.kind === "client") created.set(op.opId, r.id);
    applied.push(r);
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
        id: true, code: true, legacyQr: true, name: true, phone: true, address: true,
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
      select: { id: true, name: true, phone: true, address: true, rc: true, nif: true, ai: true, logoUrl: true },
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
            id: companyId,
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
