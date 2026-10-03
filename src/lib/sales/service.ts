import { prisma } from "@/lib/db";
import { getOrCreateSettings } from "@/lib/settings/helpers";
import { nextDocNumber, ensureSeasonFor } from "@/lib/docs/sequences";
import { consumeStock, addStock, weightedCost } from "@/lib/inventory/stock";
import { z } from "zod";
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
};

/// Resolve lines: tier price (explicit → client tier → salePrice), conversions → baseQty.
async function priceLines(
  companyId: string,
  clientTierId: string | null,
  tierId: string | null,
  lines: Array<{ productId: string; unitId?: string | null; qty: number; unitPrice?: number | null; remise?: number }>,
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
    if (l.unitId) {
      const c = conversions.find((x) => x.productId === l.productId && x.unitId === l.unitId);
      if (!c) throw Object.assign(new Error("bad_unit"), { status: 400 });
      factor = Number(c.factor);
      // Sub-base units (1 piece = 1/N base) normalize to exact 1/N.
      if (factor < 1) factor = 1 / Math.round(1 / factor);
    }
    const tierPrice = tier ? p.tierPrices.find((x) => x.tierId === tier!.id) : null;
    // Stored prices are per base unit; scale to the chosen unit unless overridden.
    const basePrice = tierPrice ? Number(tierPrice.price) : Number(p.salePrice);
    const unitPrice = l.unitPrice ?? basePrice * factor;
    const remise = l.remise ?? 0;
    if (remise > 0 && !allowRemise) throw Object.assign(new Error("remise_disabled"), { status: 400 });
    return {
      productId: l.productId,
      unitId: l.unitId ?? null,
      qty: l.qty,
      baseQty: l.qty * factor,
      unitPrice,
      remise,
      lineTotal: Math.max(0, l.qty * unitPrice - remise),
    };
  });
  return { priced, tierId: tier?.id ?? null };
}

/// Credit guard: unpaid amounts need credit ON + client + within limit (0 = cash only).
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
  if (limit <= 0) throw Object.assign(new Error("no_credit_allowed"), { status: 400 });
  if (Number(client.balance) + due > limit + 1e-9) {
    throw Object.assign(new Error("credit_limit_exceeded"), { status: 400 });
  }
}

export async function createOrder(companyId: string, input: OrderInput, opts?: { portal?: boolean; createdBy?: string }) {
  const settings = await getOrCreateSettings(companyId);
  const client = await prisma.customer.findFirst({ where: { id: input.clientId, companyId } });
  if (!client || !client.isActive) throw Object.assign(new Error("bad_client"), { status: 400 });

  const { priced, tierId } = await priceLines(companyId, client.tierId, input.tierId ?? null, input.lines, settings.remiseEnabled, settings.pieceSalesEnabled);
  const linesTotal = priced.reduce((s, l) => s + l.lineTotal, 0);
  const total = Math.max(0, linesTotal - (input.remise ?? 0));
  if ((input.remise ?? 0) > 0 && !settings.remiseEnabled) throw Object.assign(new Error("remise_disabled"), { status: 400 });
  const paid = input.paid ?? 0;
  if (paid > total + 1e-9) throw Object.assign(new Error("overpaid"), { status: 400 });
  // No credit check here: a DRAFT order is a pure product request — the
  // client owes nothing yet. The money guard runs at deliver (which books
  // the debt), where it belongs.

  const date = new Date();
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
          })),
        },
      },
      include: { lines: { include: { product: true } }, client: true },
    });
  });
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
export async function deliverOrder(companyId: string, saleId: string, locationId: string, extraPaid = 0) {
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
  if (paid > Number(order.total) + 1e-9) throw Object.assign(new Error("overpaid"), { status: 400 });
  await checkCredit(companyId, order.clientId, Number(order.total) - paid, settings);

  const date = new Date();
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
export async function createTicket(companyId: string, userId: string, input: TicketInput) {
  const settings = await getOrCreateSettings(companyId);
  const channel = input.channel ?? "VAN";
  if (channel === "POS" && !settings.posEnabled) throw Object.assign(new Error("pos_disabled"), { status: 400 });

  // Role rules: Livreurs deliver, they don't sell. Vendeurs in LOCKED mode
  // sell only from their assigned van.
  const actor = await prisma.user.findFirst({ where: { id: userId, companyId }, include: { assignedVans: { select: { id: true } } } });
  if (actor && actor.role === "Livreur") throw Object.assign(new Error("forbidden_role"), { status: 403 });
  if (actor && actor.role === "Vendeur" && settings.vanBindingMode === "LOCKED" && channel === "VAN") {
    const allowed = actor.assignedVans.some((v) => v.id === input.locationId);
    if (!allowed) throw Object.assign(new Error("van_not_assigned"), { status: 403 });
  }

  const location = await prisma.store.findFirst({ where: { id: input.locationId, companyId } });
  if (!location) throw Object.assign(new Error("bad_location"), { status: 400 });

  let client = input.clientId
    ? await prisma.customer.findFirst({ where: { id: input.clientId, companyId } })
    : null;
  if (input.clientId && (!client || !client.isActive)) throw Object.assign(new Error("bad_client"), { status: 400 });

  // QR rule on van sales: strict blocks unscanned, lenient flags offList.
  let offList = false;
  if (channel === "VAN" && client) {
    if (!input.qrScanned) {
      if (settings.qrStrictMode) throw Object.assign(new Error("qr_required"), { status: 400 });
      offList = true;
    }
    // Off-tournée sale: open tournee for this van today missing this client.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tournee = await prisma.tournee.findFirst({
      where: { companyId, locationId: location.id, status: "OPEN", date: { gte: today } },
      include: { stops: { where: { clientId: client.id } } },
    });
    if (tournee && tournee.stops.length === 0) offList = true;
  }

  const { priced, tierId } = await priceLines(companyId, client?.tierId ?? null, input.tierId ?? null, input.lines, settings.remiseEnabled, settings.pieceSalesEnabled);
  const linesTotal = priced.reduce((s, l) => s + l.lineTotal, 0);
  const total = Math.max(0, linesTotal - (input.remise ?? 0));
  if ((input.remise ?? 0) > 0 && !settings.remiseEnabled) throw Object.assign(new Error("remise_disabled"), { status: 400 });
  const paid = input.paid ?? total;
  if (paid > total + 1e-9) throw Object.assign(new Error("overpaid"), { status: 400 });
  await checkCredit(companyId, client?.id ?? null, total - paid, settings);

  const date = new Date();
  const season = await ensureSeasonFor(companyId, date);
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
        remise: input.remise ?? 0,
        total,
        paid,
        offList,
        qrScanned: input.qrScanned ?? false,
        notes: input.notes ?? null,
        date,
        lines: {
          create: priced.map((l, i) => ({
            productId: l.productId,
            unitId: l.unitId,
            qty: l.qty,
            baseQty: l.baseQty,
            unitPrice: l.unitPrice,
            remise: l.remise,
            lineTotal: l.lineTotal,
            unitCost: costs[i] ?? 0,
          })),
        },
      },
      include: { lines: { include: { product: true } }, client: true, location: true },
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
export async function createClientReturn(companyId: string, input: ReturnInput) {
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
  const date = new Date();
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
