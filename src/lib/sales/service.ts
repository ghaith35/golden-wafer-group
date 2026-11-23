import { prisma } from "@/lib/db";
import { getOrCreateSettings } from "@/lib/settings/helpers";
import { nextDocNumber, ensureSeasonFor } from "@/lib/docs/sequences";
import { consumeStock, addStock, weightedCost } from "@/lib/inventory/stock";
import { z } from "zod";
import { applyThreePack } from "@/lib/threepack/service";
import { orderSchema, ticketSchema, deliverSchema, clientReturnSchema } from "@/lib/sales/validation";

type OrderInput = z.infer<typeof orderSchema>;
type TicketInput = z.infer<typeof ticketSchema>;
type DeliverInput = z.infer<typeof deliverSchema>;
type ReturnInput = z.infer<typeof clientReturnSchema>;

const SERIES = { ORDER: "CMD", DELIVERY: "BL", INVOICE: "FAC", TICKET: "TCK" } as const;

type PricedLine = {
  productId: string;
  unitId: string | null;
  qty: number;
  baseQty: number;
  unitPrice: number;
  remise: number;
  lineTotal: number;
  /// 3pack gift line (price 0, stock still deducted).
  isBonus?: boolean;
  bonusRuleId?: string | null;
  /// Price typed by hand (explicit unitPrice) — price deals never override it.
  manualPrice?: boolean;
};

/// Resolve lines: tier price (explicit → client tier → salePrice), conversions → baseQty.
async function priceLines(
  companyId: string,
  clientTierId: string | null,
  tierId: string | null,
  lines: Array<{ productId: string; unitId?: string | null; qty: number; unitPrice?: number | null; remise?: number; bonusRuleId?: string | null }>,
  allowRemise: boolean,
  allowPieces = true,
): Promise<{ priced: PricedLine[]; tierId: string | null }> {
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, companyId },
    include: { tierPrices: true },
  });
  if (products.length !== productIds.length) throw Object.assign(new Error("bad_product"), { status: 400 });

  let tier: { id: string } | null = null;
  const wantedTier = tierId ?? clientTierId;
  if (wantedTier) {
    tier = await prisma.priceTier.findFirst({ where: { id: wantedTier, companyId } });
    if (!tier) throw Object.assign(new Error("bad_tier"), { status: 400 });
  }

  const conversions = await prisma.productUnitConversion.findMany({ where: { productId: { in: productIds } } });
  const priced = lines.map((l) => {
    const p = products.find((x) => x.id === l.productId)!;
    // Colisage-only rule (pieceSalesEnabled OFF): packed products sell by
    // whole packs — loose pieces are rejected here, not just hidden in the
    // UI, so the APK/sync path is covered too.
    if (!allowPieces) {
      const convs = conversions.filter((x) => x.productId === l.productId);
      const soldIsBase = !l.unitId || (!!p.baseUnitId && l.unitId === p.baseUnitId);
      const ok = soldIsBase
        ? convs.some((x) => Number(x.factor) < 1) // base is itself a pack
        : convs.some((x) => x.unitId === l.unitId && Number(x.factor) > 1);
      if (!ok && (convs.some((x) => Number(x.factor) > 1) || convs.some((x) => Number(x.factor) < 1))) {
        throw Object.assign(new Error("piece_sale_forbidden"), { status: 400 });
      }
    }
    let factor = 1;
    // The base unit is factor 1 by definition — it has no conversion row.
    if (l.unitId && l.unitId !== p.baseUnitId) {
      const c = conversions.find((x) => x.productId === l.productId && x.unitId === l.unitId);
      if (!c) throw Object.assign(new Error("bad_unit"), { status: 400 });
      factor = Number(c.factor);
      // Sub-base units (1 piece = 1/N base) normalize to exact 1/N.
      if (factor < 1) factor = 1 / Math.round(1 / factor);
    }
    const tierPrice = tier ? p.tierPrices.find((x) => x.tierId === tier!.id) : null;
    // Stored prices are per base unit; scale to the chosen unit unless overridden.
    const basePrice = tierPrice ? Number(tierPrice.price) : Number(p.salePrice);
    // 3pack gift lines (only the offline phone sends them) are always free.
    const isBonus = !!l.bonusRuleId;
    const unitPrice = isBonus ? 0 : l.unitPrice ?? basePrice * factor;
    const remise = isBonus ? 0 : l.remise ?? 0;
    if (remise > 0 && !allowRemise) throw Object.assign(new Error("remise_disabled"), { status: 400 });
    return {
      productId: l.productId,
      unitId: l.unitId ?? null,
      qty: l.qty,
      baseQty: l.qty * factor,
      unitPrice,
      remise,
      lineTotal: Math.max(0, l.qty * unitPrice - remise),
      ...(isBonus ? { isBonus: true, bonusRuleId: l.bonusRuleId ?? null } : {}),
      ...(!isBonus && l.unitPrice != null ? { manualPrice: true } : {}),
    };
  });
  return { priced, tierId: tier?.id ?? null };
}

/// Money tolerance: anything within half a centime is float dust from price
/// divisions (e.g. 1150/12), never a real overpayment. Only paying MORE than
/// the invoice total raises `overpaid`.
const MONEY_EPS = 0.005;
const isOverpaid = (paid: number, total: number): boolean => paid - total > MONEY_EPS;

/// Credit guard: unpaid amounts need credit ON + client. A positive ceiling
/// caps the debt; 0 means unlimited (no cap).
async function checkCredit(
  companyId: string,
  clientId: string | null,
  due: number,
  settings: { creditSalesEnabled: boolean; debtTrackingEnabled: boolean },
) {
  if (due <= 1e-9) return;
  if (!settings.creditSalesEnabled) throw Object.assign(new Error("cash_only"), { status: 400 });
  if (!settings.debtTrackingEnabled) throw Object.assign(new Error("debt_disabled"), { status: 400 });
  if (!clientId) throw Object.assign(new Error("client_required"), { status: 400 });
  const client = await prisma.customer.findFirst({ where: { id: clientId, companyId } });
  if (!client) throw Object.assign(new Error("bad_client"), { status: 400 });
  const limit = Number(client.creditLimit);
  if (limit > 0 && Number(client.balance) + due > limit + 1e-9) {
    throw Object.assign(new Error("credit_limit_exceeded"), { status: 400 });
  }
}

export async function createOrder(
  companyId: string,
  input: OrderInput,
  opts?: { portal?: boolean; createdBy?: string; opId?: string | null; occurredAt?: Date | null },
) {
  const settings = await getOrCreateSettings(companyId);
  const client = await prisma.customer.findFirst({ where: { id: input.clientId, companyId } });
  if (!client || !client.isActive) throw Object.assign(new Error("bad_client"), { status: 400 });

  const { priced: priced0, tierId } = await priceLines(companyId, client.tierId, input.tierId ?? null, input.lines, settings.remiseEnabled, settings.pieceSalesEnabled);
  // 3pack: portal orders never earn gifts; sync ops (opId) keep the phone's capped gifts.
  const priced = await applyThreePack(companyId, opts?.portal ? { threePackEnabled: false } : settings, priced0, { fromSync: !!opts?.opId });
  const linesTotal = priced.reduce((s, l) => s + l.lineTotal, 0);
  const total = Math.max(0, linesTotal - (input.remise ?? 0));
  if ((input.remise ?? 0) > 0 && !settings.remiseEnabled) throw Object.assign(new Error("remise_disabled"), { status: 400 });
  const paid = input.paid ?? 0;
  if (isOverpaid(paid, total)) throw Object.assign(new Error("overpaid"), { status: 400 });
  // No credit check here: a DRAFT order is a pure product request — the
  // client owes nothing yet. The money guard runs at deliver (which books
  // the debt), where it belongs.

  const date = opts?.occurredAt ?? new Date();
  const season = await ensureSeasonFor(companyId, date);
  // Van attribution: orders taken by a vendeur carry their van (sidebar,
  // van loading, debts). Validated when present, otherwise plain depot order.
  let locationId: string | null = null;
  if (input.locationId) {
    const loc = await prisma.store.findFirst({ where: { id: input.locationId, companyId } });
    if (!loc) throw Object.assign(new Error("bad_location"), { status: 400 });
    locationId = loc.id;
  }
  return prisma.$transaction(async (tx) => {
    const number = await nextDocNumber(tx, companyId, "sale_order", date.getFullYear(), SERIES.ORDER);
    return tx.sale.create({
      data: {
        companyId,
        seasonId: season.id,
        kind: "ORDER",
        status: "DRAFT",
        channel: input.channel ?? (locationId ? "VAN" : "DEPOT"),
        number,
        clientId: client.id,
        locationId,
        tierId,
        tourneeId: input.tourneeId ?? null,
        isPortal: opts?.portal ?? false,
        createdById: opts?.createdBy ?? null,
        opId: opts?.opId ?? null,
        remise: input.remise ?? 0,
        total,
        paid,
        notes: input.notes ?? null,
        date,
        lines: {
          create: priced.map((l) => ({
            productId: l.productId,
            unitId: l.unitId,
            qty: l.qty,
            baseQty: l.baseQty,
            unitPrice: l.unitPrice,
            remise: l.remise,
            lineTotal: l.lineTotal,
            isBonus: !!l.isBonus,
            bonusRuleId: l.bonusRuleId ?? null,
          })),
        },
      },
      include: { lines: { include: { product: true } }, client: true },
    });
  });
}

/// Admin edit of a not-yet-delivered order (DRAFT/CONFIRMED): replaces the
/// lines and re-prices them. No stock moves for orders, so this is safe;
/// number, date, van and status are kept.
export async function updateOrder(companyId: string, saleId: string, input: OrderInput) {
  const order = await prisma.sale.findFirst({ where: { id: saleId, companyId, kind: "ORDER" } });
  if (!order) throw Object.assign(new Error("not_found"), { status: 404 });
  if (order.status !== "DRAFT" && order.status !== "CONFIRMED") throw Object.assign(new Error("bad_status"), { status: 400 });
  const settings = await getOrCreateSettings(companyId);
  const client = await prisma.customer.findFirst({ where: { id: input.clientId, companyId } });
  if (!client) throw Object.assign(new Error("bad_client"), { status: 400 });
  if ((input.remise ?? 0) > 0 && !settings.remiseEnabled) throw Object.assign(new Error("remise_disabled"), { status: 400 });
  const { priced: priced0, tierId } = await priceLines(companyId, client.tierId, input.tierId ?? null, input.lines, settings.remiseEnabled, settings.pieceSalesEnabled);
  const priced = await applyThreePack(companyId, settings, priced0, { fromSync: false });
  const total = Math.max(0, priced.reduce((x, l) => x + l.lineTotal, 0) - (input.remise ?? 0));
  const paid = input.paid ?? Number(order.paid ?? 0);
  if (isOverpaid(paid, total)) throw Object.assign(new Error("overpaid"), { status: 400 });
  return prisma.$transaction(async (tx) => {
    await tx.saleLine.deleteMany({ where: { saleId } });
    return tx.sale.update({
      where: { id: saleId },
      data: {
        clientId: client.id,
        tierId,
        remise: input.remise ?? 0,
        total,
        paid,
        notes: input.notes ?? null,
        lines: {
          create: priced.map((l) => ({
            productId: l.productId, unitId: l.unitId, qty: l.qty, baseQty: l.baseQty,
            unitPrice: l.unitPrice, remise: l.remise, lineTotal: l.lineTotal,
            isBonus: !!l.isBonus, bonusRuleId: l.bonusRuleId ?? null,
          })),
        },
      },
      include: { lines: { include: { product: true } }, client: true },
    });
  });
}

/// Admin delete of an order that never turned into a delivery/invoice.
export async function deleteOrder(companyId: string, saleId: string) {
  const order = await prisma.sale.findFirst({
    where: { id: saleId, companyId, kind: "ORDER" },
    include: { children: { select: { id: true } } },
  });
  if (!order) throw Object.assign(new Error("not_found"), { status: 404 });
  if (order.status === "DELIVERED" || order.status === "INVOICED" || order.children.length > 0) {
    throw Object.assign(new Error("bad_status"), { status: 400 });
  }
  if (Number(order.paid ?? 0) > 0) throw Object.assign(new Error("has_payment"), { status: 400 });
  await prisma.sale.delete({ where: { id: saleId } });
  return { ok: true };
}

export async function confirmOrder(companyId: string, saleId: string) {
  const order = await prisma.sale.findFirst({
    where: { id: saleId, companyId, kind: "ORDER" },
    include: { lines: { include: { product: { select: { id: true, name: true, stockQty: true } } } } },
  });
  if (!order) throw Object.assign(new Error("not_found"), { status: 404 });
  if (order.status !== "DRAFT") throw Object.assign(new Error("bad_status"), { status: 400 });
  // Stock hold: confirming promises the goods. Verify global availability
  // per product now so the van loading later can't come up empty. The actual
  // stock move still happens at deliver (per location).
  const need = new Map<string, { name: string; qty: number }>();
  for (const l of order.lines) {
    const e = need.get(l.productId) ?? { name: l.product.name, qty: 0 };
    e.qty += Number(l.baseQty);
    need.set(l.productId, e);
  }
  const short: Array<{ productId: string; name: string; need: number; have: number }> = [];
  for (const [pid, n] of need) {
    const p = await prisma.product.findFirst({ where: { id: pid, companyId }, select: { stockQty: true } });
    const have = Number(p?.stockQty ?? 0);
    if (have + 1e-9 < n.qty) short.push({ productId: pid, name: n.name, need: n.qty, have });
  }
  if (short.length) {
    throw Object.assign(new Error("insufficient_stock"), { status: 400, short });
  }
  return prisma.sale.update({ where: { id: order.id }, data: { status: "CONFIRMED" } });
}

/// Deliver an order: consume stock, snapshot COGS, create BL, book client debt.
export async function deliverOrder(companyId: string, saleId: string, locationId: string, extraPaid = 0, opts?: { opId?: string; at?: Date }) {
  const settings = await getOrCreateSettings(companyId);
  const order = await prisma.sale.findFirst({
    where: { id: saleId, companyId, kind: "ORDER" },
    include: { lines: true, client: true },
  });
  if (!order) throw Object.assign(new Error("not_found"), { status: 404 });
  if (order.status !== "CONFIRMED") throw Object.assign(new Error("bad_status"), { status: 400 });
  const location = await prisma.store.findFirst({ where: { id: locationId, companyId } });
  if (!location) throw Object.assign(new Error("bad_location"), { status: 400 });

  const paid = Number(order.paid) + extraPaid;
  if (isOverpaid(paid, Number(order.total))) throw Object.assign(new Error("overpaid"), { status: 400 });
  await checkCredit(companyId, order.clientId, Number(order.total) - paid, settings);

  const date = opts?.at && !Number.isNaN(opts.at.getTime()) ? opts.at : new Date();
  const season = await ensureSeasonFor(companyId, date);
  return prisma.$transaction(async (tx) => {
    const number = await nextDocNumber(tx, companyId, "sale_delivery", date.getFullYear(), SERIES.DELIVERY);

    // Consume stock per line (oversell → negative batch on vans when allowed).
    const costs: number[] = [];
    for (const l of order.lines) {
      try {
        const consumed = await consumeStock(tx, {
          companyId,
          locationId,
          productId: l.productId,
          qty: Number(l.baseQty),
          fefo: settings.expiryEnabled,
        });
        costs.push(weightedCost(consumed));
      } catch (e) {
        if ((e as Error).message === "insufficient_stock" && settings.oversellAllowed && location.kind === "VAN") {
          const avail = (e as Error & { available?: number }).available ?? 0;
          if (avail > 1e-9) {
            const consumed = await consumeStock(tx, { companyId, locationId, productId: l.productId, qty: avail, fefo: settings.expiryEnabled });
            costs.push(weightedCost(consumed));
          } else {
            costs.push(0);
          }
          const p = await tx.product.findUniqueOrThrow({ where: { id: l.productId } });
          await addStock(tx, { companyId, locationId, productId: l.productId, qty: -(Number(l.baseQty) - avail), unitCost: Number(p.costPrice) });
        } else {
          throw e;
        }
      }
      await tx.product.update({ where: { id: l.productId }, data: { stockQty: { decrement: Number(l.baseQty) } } });
    }

    const delivery = await tx.sale.create({
      data: {
        companyId,
        seasonId: season.id,
        kind: "DELIVERY",
        status: "DELIVERED",
        channel: location.kind === "VAN" ? "VAN" : "DEPOT",
        number,
        clientId: order.clientId,
        locationId,
        tierId: order.tierId,
        tourneeId: order.tourneeId,
        sourceId: order.id,
        opId: opts?.opId ?? null,
        remise: order.remise,
        total: order.total,
        paid,
        notes: order.notes,
        date,
        lines: {
          create: order.lines.map((l, i) => ({
            productId: l.productId,
            unitId: l.unitId,
            qty: l.qty,
            baseQty: l.baseQty,
            unitPrice: l.unitPrice,
            remise: l.remise,
            lineTotal: l.lineTotal,
            isBonus: !!l.isBonus,
            bonusRuleId: l.bonusRuleId ?? null,
            unitCost: costs[i] ?? 0,
          })),
        },
      },
      include: { lines: { include: { product: true } }, client: true },
    });

    await tx.sale.update({ where: { id: order.id }, data: { status: "DELIVERED", paid } });
    const due = Number(order.total) - paid;
    if (due > 1e-9 && order.clientId && settings.debtTrackingEnabled) {
      await tx.customer.update({ where: { id: order.clientId }, data: { balance: { increment: due } } });
    }
    if (order.tourneeId && order.clientId) {
      const stop = await tx.tourneeStop.findUnique({
        where: { tourneeId_clientId: { tourneeId: order.tourneeId, clientId: order.clientId } },
      });
      if (stop) {
        await tx.tourneeStop.update({
          where: { id: stop.id },
          data: { visited: true, sold: true, total: { increment: Number(order.total) } },
        });
      }
    }
    return delivery;
  });
}

/// Immediate van/POS/depot ticket: stock out + cash + debt in one step.
export async function createTicket(
  companyId: string,
  userId: string,
  input: TicketInput,
  opts?: { opId?: string | null; occurredAt?: Date | null },
) {
  const settings = await getOrCreateSettings(companyId);
  const channel = input.channel ?? "VAN";
  if (channel === "POS" && !settings.posEnabled) throw Object.assign(new Error("pos_disabled"), { status: 400 });

  // Role rules: Livreurs sell on their tournée van (one driver may run a
  // different van each day of the weekly round, so no single-van binding
  // for them — the open tournée scopes the sale). Vendeurs in LOCKED mode
  // sell only from their assigned van.
  const actor = await prisma.user.findFirst({ where: { id: userId, companyId }, include: { assignedVans: { select: { id: true } } } });
  if (actor && actor.role === "Vendeur" && settings.vanBindingMode === "LOCKED" && channel === "VAN") {
    const allowed = actor.assignedVans.some((v) => v.id === input.locationId);
    if (!allowed) throw Object.assign(new Error("van_not_assigned"), { status: 403 });
  }

  const location = await prisma.store.findFirst({ where: { id: input.locationId, companyId } });
  if (!location) throw Object.assign(new Error("bad_location"), { status: 400 });

  const client = input.clientId
    ? await prisma.customer.findFirst({ where: { id: input.clientId, companyId } })
    : null;
  if (input.clientId && (!client || !client.isActive)) throw Object.assign(new Error("bad_client"), { status: 400 });

  // QR rule on van sales only: the main depot (and POS/depot channels)
  // never requires a client QR scan — no QR round exists there.
  let offList = false;
  if (channel === "VAN" && location.kind === "VAN" && client) {
    if (!input.qrScanned) {
      if (location.qrSellRequired) throw Object.assign(new Error("qr_required"), { status: 400 });
      offList = true;
    }
    // Off-tournée sale: open tournee for this van today missing this client.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // A van can run two tours a day: off-tour only if NONE of today's open
    // tours has this client.
    const tournees = await prisma.tournee.findMany({
      where: { companyId, locationId: location.id, status: "OPEN", date: { gte: today } },
      include: { stops: { where: { clientId: client.id } } },
    });
    if (tournees.length > 0 && tournees.every((t) => t.stops.length === 0)) offList = true;
  }

  const { priced: priced0, tierId } = await priceLines(companyId, client?.tierId ?? null, input.tierId ?? null, input.lines, settings.remiseEnabled, settings.pieceSalesEnabled);
  // 3pack: gifts are added server-side (sync ops keep the phone's capped gifts).
  const priced = await applyThreePack(companyId, settings, priced0, { fromSync: !!opts?.opId });
  const linesTotal = priced.reduce((s, l) => s + l.lineTotal, 0);
  const total = Math.max(0, linesTotal - (input.remise ?? 0));
  if ((input.remise ?? 0) > 0 && !settings.remiseEnabled) throw Object.assign(new Error("remise_disabled"), { status: 400 });
  const paid = input.paid ?? total;
  if (isOverpaid(paid, total)) throw Object.assign(new Error("overpaid"), { status: 400 });
  await checkCredit(companyId, client?.id ?? null, total - paid, settings);

  const date = opts?.occurredAt ?? new Date();
  const season = await ensureSeasonFor(companyId, date);
  // Silent sale-site check (admin eyes only): phone fix vs the client's
  // registered position. Out-of-range/missing → all null, never a failure.
  const { computeSaleDistM } = await import("./site-check");
  const { haversineM } = await import("@/lib/geo-math");
  const inRange = (v: unknown, lim: number) =>
    typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= lim ? v : null;
  const fixLat = inRange(input.saleLat, 90);
  const fixLng = inRange(input.saleLng, 180);
  const siteCheck = {
    saleLat: fixLat,
    saleLng: fixLng,
    saleDistM:
      fixLat == null || fixLng == null
        ? null
        : computeSaleDistM(fixLat, fixLng, client?.gpsLat ?? null, client?.gpsLng ?? null, haversineM),
  };
  return prisma.$transaction(async (tx) => {
    const number = await nextDocNumber(tx, companyId, "sale_ticket", date.getFullYear(), SERIES.TICKET);

    const costs: number[] = [];
    for (const l of priced) {
      try {
        const consumed = await consumeStock(tx, { companyId, locationId: location.id, productId: l.productId, qty: l.baseQty, fefo: settings.expiryEnabled });
        costs.push(weightedCost(consumed));
      } catch (e) {
        if ((e as Error).message === "insufficient_stock" && settings.oversellAllowed && location.kind === "VAN") {
          const avail = (e as Error & { available?: number }).available ?? 0;
          if (avail > 1e-9) {
            const consumed = await consumeStock(tx, { companyId, locationId: location.id, productId: l.productId, qty: avail, fefo: settings.expiryEnabled });
            costs.push(weightedCost(consumed));
          } else {
            costs.push(0);
          }
          const p = await tx.product.findUniqueOrThrow({ where: { id: l.productId } });
          await addStock(tx, { companyId, locationId: location.id, productId: l.productId, qty: -(l.baseQty - avail), unitCost: Number(p.costPrice) });
        } else {
          throw e;
        }
      }
      await tx.product.update({ where: { id: l.productId }, data: { stockQty: { decrement: l.baseQty } } });
    }

    const ticket = await tx.sale.create({
      data: {
        companyId,
        seasonId: season.id,
        kind: "TICKET",
        status: "DELIVERED",
        channel,
        number,
        clientId: client?.id ?? null,
        locationId: location.id,
        tierId,
        tourneeId: input.tourneeId ?? null,
        createdById: userId,
        opId: opts?.opId ?? null,
        remise: input.remise ?? 0,
        total,
        paid,
        offList,
        qrScanned: input.qrScanned ?? false,
        notes: input.notes ?? null,
        date,
        ...siteCheck,
        lines: {
          create: priced.map((l, i) => ({
            productId: l.productId,
            unitId: l.unitId,
            qty: l.qty,
            baseQty: l.baseQty,
            unitPrice: l.unitPrice,
            remise: l.remise,
            lineTotal: l.lineTotal,
            isBonus: !!l.isBonus,
            bonusRuleId: l.bonusRuleId ?? null,
            unitCost: costs[i] ?? 0,
          })),
        },
      },
      include: { lines: { include: { product: true } }, client: { include: { tier: true } }, location: true },
    });

    const due = total - paid;
    if (due > 1e-9 && client && settings.debtTrackingEnabled) {
      await tx.customer.update({ where: { id: client.id }, data: { balance: { increment: due } } });
    }
    // Tournée progress: mark the stop visited + sold.
    if (input.tourneeId && client) {
      const stop = await tx.tourneeStop.findUnique({
        where: { tourneeId_clientId: { tourneeId: input.tourneeId, clientId: client.id } },
      });
      if (stop) {
        await tx.tourneeStop.update({
          where: { id: stop.id },
          data: { visited: true, sold: true, total: { increment: total } },
        });
      }
    }
    void userId;
    return ticket;
  });
}

/// Edit a posted TICKET in place (facture edit): reverse its postings, then
/// re-apply the new lines — same number, same date, same season. Guards:
/// no live children, no client returns, same client (changing the client is
/// cancel + recreate). Location may change (reversal uses the old one).
export async function updateTicket(
  companyId: string,
  saleId: string,
  input: TicketInput,
) {
  const settings = await getOrCreateSettings(companyId);
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, companyId, kind: "TICKET" },
    include: { lines: true },
  });
  if (!sale) throw Object.assign(new Error("not_found"), { status: 404 });
  if (sale.status === "CANCELLED") throw Object.assign(new Error("bad_status"), { status: 400 });
  const liveChildren = await prisma.sale.count({
    where: { companyId, sourceId: sale.id, status: { not: "CANCELLED" } },
  });
  if (liveChildren > 0) throw Object.assign(new Error("has_children"), { status: 400 });
  const returnCount = await prisma.clientReturn.count({ where: { companyId, saleId: sale.id } });
  if (returnCount > 0) throw Object.assign(new Error("has_returns"), { status: 400 });
  if ((input.clientId ?? null) !== sale.clientId) {
    throw Object.assign(new Error("client_change_forbidden"), { status: 400 });
  }

  const location = await prisma.store.findFirst({ where: { id: input.locationId, companyId } });
  if (!location) throw Object.assign(new Error("bad_location"), { status: 400 });
  const client = sale.clientId
    ? await prisma.customer.findFirst({ where: { id: sale.clientId, companyId } })
    : null;
  if (sale.clientId && (!client || !client.isActive)) throw Object.assign(new Error("bad_client"), { status: 400 });

  const { priced: priced0, tierId } = await priceLines(companyId, client?.tierId ?? null, input.tierId ?? null, input.lines, settings.remiseEnabled, settings.pieceSalesEnabled);
  const priced = await applyThreePack(companyId, settings, priced0, { fromSync: false });
  const linesTotal = priced.reduce((s, l) => s + l.lineTotal, 0);
  const total = Math.max(0, linesTotal - (input.remise ?? 0));
  if ((input.remise ?? 0) > 0 && !settings.remiseEnabled) throw Object.assign(new Error("remise_disabled"), { status: 400 });
  const paid = input.paid ?? total;
  if (isOverpaid(paid, total)) throw Object.assign(new Error("overpaid"), { status: 400 });

  return prisma.$transaction(async (tx) => {
    // 1. Reverse old postings (mirror cancelSale, without cancelling).
    if (sale.locationId) {
      for (const l of sale.lines) {
        await addStock(tx, {
          companyId,
          locationId: sale.locationId,
          productId: l.productId,
          qty: Number(l.baseQty),
          unitCost: Number(l.unitCost),
        });
        await tx.product.update({ where: { id: l.productId }, data: { stockQty: { increment: Number(l.baseQty) } } });
      }
    }
    const oldDue = Number(sale.total) - Number(sale.paid);
    if (oldDue > 1e-9 && sale.clientId && settings.debtTrackingEnabled) {
      await tx.customer.update({ where: { id: sale.clientId }, data: { balance: { decrement: oldDue } } });
    }
    await tx.saleLine.deleteMany({ where: { saleId: sale.id } });
    // Tournée stop total: take the old ticket back out (re-added below).
    if (sale.tourneeId && sale.clientId) {
      const stop = await tx.tourneeStop.findUnique({
        where: { tourneeId_clientId: { tourneeId: sale.tourneeId, clientId: sale.clientId } },
      });
      if (stop) {
        await tx.tourneeStop.update({
          where: { id: stop.id },
          data: { total: { decrement: Number(sale.total) } },
        });
      }
    }

    // 2. Credit check against the reversed balance (an edit that lowers the
    // due must not trip on the pre-edit balance). Read inside the tx so the
    // reversal above is visible.
    {
      const fresh = client ? await tx.customer.findUnique({ where: { id: client.id } }) : null;
      const due = total - paid;
      if (due > 1e-9) {
        if (!settings.creditSalesEnabled) throw Object.assign(new Error("cash_only"), { status: 400 });
        if (!settings.debtTrackingEnabled) throw Object.assign(new Error("debt_disabled"), { status: 400 });
        if (!fresh) throw Object.assign(new Error("bad_client"), { status: 400 });
        const limit = Number(fresh.creditLimit);
        if (limit > 0 && Number(fresh.balance) + due > limit + 1e-9) {
          throw Object.assign(new Error("credit_limit_exceeded"), { status: 400 });
        }
      }
    }

    // 3. Apply new lines (mirror createTicket consume loop, VAN oversell incl.).
    const costs: number[] = [];
    for (const l of priced) {
      try {
        const consumed = await consumeStock(tx, { companyId, locationId: location.id, productId: l.productId, qty: l.baseQty, fefo: settings.expiryEnabled });
        costs.push(weightedCost(consumed));
      } catch (e) {
        if ((e as Error).message === "insufficient_stock" && settings.oversellAllowed && location.kind === "VAN") {
          const avail = (e as Error & { available?: number }).available ?? 0;
          if (avail > 1e-9) {
            const consumed = await consumeStock(tx, { companyId, locationId: location.id, productId: l.productId, qty: avail, fefo: settings.expiryEnabled });
            costs.push(weightedCost(consumed));
          } else {
            costs.push(0);
          }
          const p = await tx.product.findUniqueOrThrow({ where: { id: l.productId } });
          await addStock(tx, { companyId, locationId: location.id, productId: l.productId, qty: -(l.baseQty - avail), unitCost: Number(p.costPrice) });
        } else {
          throw e;
        }
      }
      await tx.product.update({ where: { id: l.productId }, data: { stockQty: { decrement: l.baseQty } } });
    }

    const updated = await tx.sale.update({
      where: { id: sale.id },
      data: {
        locationId: location.id,
        tierId,
        remise: input.remise ?? 0,
        total,
        paid,
        notes: input.notes ?? null,
        lines: {
          create: priced.map((l, i) => ({
            productId: l.productId,
            unitId: l.unitId,
            qty: l.qty,
            baseQty: l.baseQty,
            unitPrice: l.unitPrice,
            remise: l.remise,
            lineTotal: l.lineTotal,
            isBonus: !!l.isBonus,
            bonusRuleId: l.bonusRuleId ?? null,
            unitCost: costs[i] ?? 0,
          })),
        },
      },
      include: { lines: { include: { product: true } }, client: { include: { tier: true } }, location: true },
    });

    const due = total - paid;
    if (due > 1e-9 && client && settings.debtTrackingEnabled) {
      await tx.customer.update({ where: { id: client.id }, data: { balance: { increment: due } } });
    }
    if (sale.tourneeId && client) {
      const stop = await tx.tourneeStop.findUnique({
        where: { tourneeId_clientId: { tourneeId: sale.tourneeId, clientId: client.id } },
      });
      if (stop) {
        await tx.tourneeStop.update({
          where: { id: stop.id },
          data: { total: { increment: total } },
        });
      }
    }
    return updated;
  });
}

/// Invoice a delivery (no stock move).
export async function createInvoice(companyId: string, deliveryId: string) {
  const delivery = await prisma.sale.findFirst({
    where: { id: deliveryId, companyId, kind: "DELIVERY" },
    include: { lines: true },
  });
  if (!delivery) throw Object.assign(new Error("not_found"), { status: 404 });
  if (delivery.status !== "DELIVERED") throw Object.assign(new Error("bad_status"), { status: 400 });
  const existing = await prisma.sale.findFirst({ where: { sourceId: delivery.id, kind: "INVOICE" } });
  if (existing) throw Object.assign(new Error("already_invoiced"), { status: 400 });

  const date = new Date();
  const season = await ensureSeasonFor(companyId, date);
  return prisma.$transaction(async (tx) => {
    const number = await nextDocNumber(tx, companyId, "sale_invoice", date.getFullYear(), SERIES.INVOICE);
    const invoice = await tx.sale.create({
      data: {
        companyId,
        seasonId: season.id,
        kind: "INVOICE",
        status: "INVOICED",
        channel: delivery.channel,
        number,
        clientId: delivery.clientId,
        locationId: delivery.locationId,
        tierId: delivery.tierId,
        sourceId: delivery.id,
        remise: delivery.remise,
        total: delivery.total,
        paid: delivery.paid,
        notes: delivery.notes,
        date,
        lines: {
          create: delivery.lines.map((l) => ({
            productId: l.productId,
            unitId: l.unitId,
            qty: l.qty,
            baseQty: l.baseQty,
            unitPrice: l.unitPrice,
            remise: l.remise,
            lineTotal: l.lineTotal,
            isBonus: !!l.isBonus,
            bonusRuleId: l.bonusRuleId ?? null,
            unitCost: l.unitCost,
          })),
        },
      },
      include: { lines: { include: { product: true } }, client: true },
    });
    await tx.sale.update({ where: { id: delivery.id }, data: { status: "INVOICED" } });
    return invoice;
  });
}

/// Cancel: restock delivered docs at recorded cost, reverse client debt.
export async function cancelSale(companyId: string, saleId: string) {
  const settings = await getOrCreateSettings(companyId);
  const sale = await prisma.sale.findFirst({ where: { id: saleId, companyId }, include: { lines: true } });
  if (!sale) throw Object.assign(new Error("not_found"), { status: 404 });
  if (sale.status === "CANCELLED") throw Object.assign(new Error("bad_status"), { status: 400 });

  return prisma.$transaction(async (tx) => {
    if ((sale.kind === "DELIVERY" || sale.kind === "TICKET") && sale.status === "DELIVERED" && sale.locationId) {
      for (const l of sale.lines) {
        await addStock(tx, {
          companyId,
          locationId: sale.locationId,
          productId: l.productId,
          qty: Number(l.baseQty),
          unitCost: Number(l.unitCost),
        });
        await tx.product.update({ where: { id: l.productId }, data: { stockQty: { increment: Number(l.baseQty) } } });
      }
      const due = Number(sale.total) - Number(sale.paid);
      if (due > 1e-9 && sale.clientId && settings.debtTrackingEnabled) {
        await tx.customer.update({ where: { id: sale.clientId }, data: { balance: { decrement: due } } });
      }
    }
    await tx.sale.update({ where: { id: sale.id }, data: { status: "CANCELLED" } });
    return { ok: true };
  });
}

/// Reopen a DELIVERED order back to "still to be delivered" (CONFIRMED):
/// cancels its delivered children (stock back, debt reversed — same reversal
/// as cancelSale) and reverts the order itself. The livreur toggles an order
/// this way when a delivery must be redone.
export async function reopenOrder(companyId: string, saleId: string) {
  const settings = await getOrCreateSettings(companyId);
  const order = await prisma.sale.findFirst({
    where: { id: saleId, companyId, kind: "ORDER" },
    include: { lines: true },
  });
  if (!order) throw Object.assign(new Error("not_found"), { status: 404 });
  if (order.status !== "DELIVERED") throw Object.assign(new Error("bad_status"), { status: 400 });
  const deliveredChildren = await prisma.sale.findMany({
    where: { companyId, kind: "DELIVERY", sourceId: order.id, status: "DELIVERED" },
    include: { lines: true },
  });
  return prisma.$transaction(async (tx) => {
    for (const del of deliveredChildren) {
      if (del.locationId) {
        for (const l of del.lines) {
          await addStock(tx, {
            companyId,
            locationId: del.locationId,
            productId: l.productId,
            qty: Number(l.baseQty),
            unitCost: Number(l.unitCost),
          });
          await tx.product.update({ where: { id: l.productId }, data: { stockQty: { increment: Number(l.baseQty) } } });
        }
      }
      const due = Number(del.total) - Number(del.paid);
      if (due > 1e-9 && del.clientId && settings.debtTrackingEnabled) {
        await tx.customer.update({ where: { id: del.clientId }, data: { balance: { decrement: due } } });
      }
      await tx.sale.update({ where: { id: del.id }, data: { status: "CANCELLED" } });
    }
    await tx.sale.update({ where: { id: order.id }, data: { status: "CONFIRMED" } });
    return { ok: true };
  });
}

/// Undo a mistaken cancellation of a DELIVERY: re-consume the stock (FIFO,
/// same oversell rules as deliverOrder), re-book the debt, back to DELIVERED.
/// Only CANCELLED deliveries qualify — tickets/orders stay cancelled, and
/// the original number/date are kept (no new document).
export async function uncancelDelivery(companyId: string, saleId: string) {
  const settings = await getOrCreateSettings(companyId);
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, companyId },
    include: { lines: true },
  });
  if (!sale) throw Object.assign(new Error("not_found"), { status: 404 });
  if (sale.kind !== "DELIVERY" || sale.status !== "CANCELLED") throw Object.assign(new Error("bad_status"), { status: 400 });
  if (!sale.locationId) throw Object.assign(new Error("bad_location"), { status: 400 });
  const location = await prisma.store.findFirst({ where: { id: sale.locationId, companyId } });
  if (!location) throw Object.assign(new Error("bad_location"), { status: 400 });
  const due = Number(sale.total) - Number(sale.paid);
  await checkCredit(companyId, sale.clientId, due, settings);
  return prisma.$transaction(async (tx) => {
    const costs: number[] = [];
    for (const l of sale.lines) {
      try {
        const consumed = await consumeStock(tx, {
          companyId,
          locationId: sale.locationId!,
          productId: l.productId,
          qty: Number(l.baseQty),
          fefo: settings.expiryEnabled,
        });
        costs.push(weightedCost(consumed));
      } catch (e) {
        if ((e as Error).message === "insufficient_stock" && settings.oversellAllowed && location.kind === "VAN") {
          const avail = (e as Error & { available?: number }).available ?? 0;
          if (avail > 1e-9) {
            const consumed = await consumeStock(tx, { companyId, locationId: sale.locationId!, productId: l.productId, qty: avail, fefo: settings.expiryEnabled });
            costs.push(weightedCost(consumed));
          } else {
            costs.push(0);
          }
          const p = await tx.product.findUniqueOrThrow({ where: { id: l.productId } });
          await addStock(tx, { companyId, locationId: sale.locationId!, productId: l.productId, qty: -(Number(l.baseQty) - avail), unitCost: Number(p.costPrice) });
        } else {
          throw e;
        }
      }
      await tx.product.update({ where: { id: l.productId }, data: { stockQty: { decrement: Number(l.baseQty) } } });
      await tx.saleLine.update({ where: { id: l.id }, data: { unitCost: costs[costs.length - 1] ?? 0 } });
    }
    if (due > 1e-9 && sale.clientId && settings.debtTrackingEnabled) {
      await tx.customer.update({ where: { id: sale.clientId }, data: { balance: { increment: due } } });
    }
    await tx.sale.update({ where: { id: sale.id }, data: { status: "DELIVERED" } });
    return { ok: true };
  });
}

/// Move a delivered doc to another van/depot: restock the old location at
/// recorded cost, consume at the new one (oversell rules apply on vans),
/// re-snapshot line costs. Totals, paid and debt are untouched.
export async function moveSale(companyId: string, saleId: string, newLocationId: string) {
  const settings = await getOrCreateSettings(companyId);
  const sale = await prisma.sale.findFirst({ where: { id: saleId, companyId }, include: { lines: true } });
  if (!sale) throw Object.assign(new Error("not_found"), { status: 404 });
  if ((sale.kind !== "DELIVERY" && sale.kind !== "TICKET") || sale.status !== "DELIVERED" || !sale.locationId) {
    throw Object.assign(new Error("bad_status"), { status: 400 });
  }
  const target = await prisma.store.findFirst({ where: { id: newLocationId, companyId } });
  if (!target) throw Object.assign(new Error("bad_location"), { status: 400 });
  if (target.id === sale.locationId) throw Object.assign(new Error("same_location"), { status: 400 });

  return prisma.$transaction(async (tx) => {
    const newCosts: number[] = [];
    for (const l of sale.lines) {
      await addStock(tx, {
        companyId,
        locationId: sale.locationId as string,
        productId: l.productId,
        qty: Number(l.baseQty),
        unitCost: Number(l.unitCost),
      });
      try {
        const consumed = await consumeStock(tx, {
          companyId,
          locationId: target.id,
          productId: l.productId,
          qty: Number(l.baseQty),
          fefo: settings.expiryEnabled,
        });
        newCosts.push(weightedCost(consumed));
      } catch (e) {
        if ((e as Error).message === "insufficient_stock" && settings.oversellAllowed && target.kind === "VAN") {
          const avail = (e as Error & { available?: number }).available ?? 0;
          if (avail > 1e-9) {
            const consumed = await consumeStock(tx, { companyId, locationId: target.id, productId: l.productId, qty: avail, fefo: settings.expiryEnabled });
            newCosts.push(weightedCost(consumed));
          } else {
            newCosts.push(0);
          }
          const p = await tx.product.findUniqueOrThrow({ where: { id: l.productId } });
          await addStock(tx, { companyId, locationId: target.id, productId: l.productId, qty: -(Number(l.baseQty) - avail), unitCost: Number(p.costPrice) });
        } else {
          throw e;
        }
      }
    }
    for (let i = 0; i < sale.lines.length; i++) {
      await tx.saleLine.update({ where: { id: sale.lines[i].id }, data: { unitCost: newCosts[i] ?? 0 } });
    }
    await tx.sale.update({
      where: { id: sale.id },
      data: { locationId: target.id, channel: target.kind === "VAN" ? "VAN" : "DEPOT" },
    });
    return { ok: true, locationId: target.id };
  });
}

/// Confirm + load: accept a DRAFT commande onto ANY van (not necessarily
/// the one that took it). Assigns the van, confirms, and transfers the
/// lines depot → van in one step. The moved stock is LOCKED: confirmed
/// lines count as held for that van, so the livreur can only deliver them —
/// never sell them (vente caps at free stock).
export async function confirmAndLoadOrder(
  companyId: string,
  userId: string,
  saleId: string,
  vanId: string
) {
  const order = await prisma.sale.findFirst({
    where: { id: saleId, companyId, kind: "ORDER" },
    include: { lines: true },
  });
  if (!order) throw Object.assign(new Error("not_found"), { status: 404 });
  if (order.status !== "DRAFT") throw Object.assign(new Error("bad_status"), { status: 400 });
  if (!order.lines.length) throw Object.assign(new Error("empty_order"), { status: 400 });
  const van = await prisma.store.findFirst({ where: { id: vanId, companyId, kind: "VAN" } });
  if (!van) throw Object.assign(new Error("bad_van"), { status: 400 });
  const depot = await prisma.store.findFirst({
    where: { companyId, kind: "DEPOT" },
    orderBy: { createdAt: "asc" },
  });

  // Pre-check depot stock BEFORE touching the order (assign/confirm must not
  // be left half-applied). The depot row only exists after the first
  // purchase, so "no depot" simply means "nothing in stock".
  const need = new Map<string, number>();
  for (const l of order.lines) need.set(l.productId, (need.get(l.productId) ?? 0) + Number(l.baseQty));
  const have = new Map<string, number>();
  if (depot) {
    const grouped = await prisma.stockBatch.groupBy({
      by: ["productId"],
      where: { companyId, storeId: depot.id, transferId: null, qty: { gt: 0 }, productId: { in: [...need.keys()] } },
      _sum: { qty: true },
    });
    for (const g of grouped) have.set(g.productId, Number(g._sum.qty ?? 0));
  }
  const shortIds = [...need].filter(([pid, n]) => (have.get(pid) ?? 0) + 1e-9 < n).map(([pid]) => pid);
  if (shortIds.length) {
    const names = await prisma.product.findMany({ where: { id: { in: shortIds }, companyId }, select: { id: true, name: true } });
    const label = names.map((p) => `${p.name} (${have.get(p.id) ?? 0}/${need.get(p.id)})`).join(", ");
    throw Object.assign(new Error(`insufficient_stock: ${label}`), { status: 400 });
  }
  if (!depot) throw Object.assign(new Error("no_depot"), { status: 400 });

  // 1. Assign + confirm (confirmOrder verifies global availability).
  await assignOrder(companyId, order.id, van.id);
  await confirmOrder(companyId, order.id);

  // 2. Move depot → van. declareTransfer consumes depot FIFO (throws
  // insufficient_stock when the depot is short); resolve immediately so the
  // van physically holds it. Held, not sellable — see vanHolds().
  const { declareTransfer, resolveTransfer } = await import("@/lib/inventory/service");
  const transfer = await declareTransfer(companyId, userId, {
    fromLocationId: depot.id,
    toLocationId: van.id,
    notes: `Commande ${order.number}`,
    lines: order.lines.map((l) => ({ productId: l.productId, qty: Number(l.baseQty) })),
  });
  const fresh = await prisma.transfer.findFirst({
    where: { id: transfer.id },
    select: { status: true, lines: { select: { id: true, declaredQty: true } } },
  });
  if (fresh?.status === "DECLARED") {
    await resolveTransfer(companyId, userId, transfer.id, {
      action: "confirm",
      lines: (fresh.lines ?? []).map((l) => ({ lineId: l.id, confirmedQty: Number(l.declaredQty) })),
    });
  }
  return prisma.sale.findFirstOrThrow({
    where: { id: order.id },
    include: { client: true, location: true, lines: { include: { product: true } } },
  });
}
export async function assignOrder(companyId: string, saleId: string, locationId: string) {
  const order = await prisma.sale.findFirst({ where: { id: saleId, companyId, kind: "ORDER" } });
  if (!order) throw Object.assign(new Error("not_found"), { status: 404 });
  if (order.status !== "DRAFT" && order.status !== "CONFIRMED") {
    throw Object.assign(new Error("bad_status"), { status: 400 });
  }
  const loc = await prisma.store.findFirst({ where: { id: locationId, companyId } });
  if (!loc) throw Object.assign(new Error("bad_location"), { status: 400 });
  return prisma.sale.update({
    where: { id: order.id },
    data: { locationId: loc.id, channel: loc.kind === "VAN" ? "VAN" : "DEPOT" },
  });
}

/// Client return: restock location + refund cash or credit the debt.
export async function createClientReturn(
  companyId: string,
  input: ReturnInput,
  opts?: { opId?: string | null; occurredAt?: Date | null },
) {
  const settings = await getOrCreateSettings(companyId);
  void settings;
  const [client, location] = await Promise.all([
    prisma.customer.findFirst({ where: { id: input.clientId, companyId } }),
    prisma.store.findFirst({ where: { id: input.locationId, companyId } }),
  ]);
  if (!client || !location) throw Object.assign(new Error("bad_ref"), { status: 400 });
  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  const products = await prisma.product.findMany({ where: { id: { in: productIds }, companyId } });
  if (products.length !== productIds.length) throw Object.assign(new Error("bad_product"), { status: 400 });

  const total = input.lines.reduce((s, l) => s + l.baseQty * l.unitPrice, 0);
  const date = opts?.occurredAt ?? new Date();
  const season = await ensureSeasonFor(companyId, date);
  return prisma.$transaction(async (tx) => {
    const number = await nextDocNumber(tx, companyId, "client_return", date.getFullYear(), "RC");
    const ret = await tx.clientReturn.create({
      data: {
        companyId,
        seasonId: season.id,
        clientId: client.id,
        saleId: input.saleId ?? null,
        locationId: location.id,
        number,
        refundType: input.refundType,
        total,
        notes: input.notes ?? null,
        date,
        opId: opts?.opId ?? null,
      },
    });
    for (const l of input.lines) {
      await tx.clientReturnLine.create({
        data: { returnId: ret.id, productId: l.productId, baseQty: l.baseQty, unitPrice: l.unitPrice, lineTotal: l.baseQty * l.unitPrice },
      });
      await addStock(tx, { companyId, locationId: location.id, productId: l.productId, qty: l.baseQty, unitCost: l.unitPrice });
      await tx.product.update({ where: { id: l.productId }, data: { stockQty: { increment: l.baseQty } } });
    }
    if (input.refundType === "DEBT_CREDIT") {
      await tx.customer.update({ where: { id: client.id }, data: { balance: { decrement: total } } });
    }
    return tx.clientReturn.findUniqueOrThrow({
      where: { id: ret.id },
      include: { lines: { include: { product: true } }, client: true },
    });
  });
}

export { SERIES };
export type { ReturnInput };

/// Van ticket lifecycle: a new ticket is ON HOLD (confirmedAt null) — the
/// driver may still edit / delete it (stock + debt are already posted and get
/// reversed by those actions). Confirming makes it final: from then on only an
/// admin can edit or cancel it. Idempotent.
export async function confirmTicket(companyId: string, saleId: string) {
  const sale = await prisma.sale.findFirst({ where: { id: saleId, companyId, kind: "TICKET" }, select: { id: true, status: true, confirmedAt: true } });
  if (!sale) throw Object.assign(new Error("not_found"), { status: 404 });
  if (sale.status !== "DELIVERED") throw Object.assign(new Error("bad_status"), { status: 400 });
  if (sale.confirmedAt) return { ok: true, confirmedAt: sale.confirmedAt };
  const row = await prisma.sale.update({ where: { id: sale.id }, data: { confirmedAt: new Date() }, select: { confirmedAt: true } });
  return { ok: true, confirmedAt: row.confirmedAt };
}
