import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { getOrCreateSettings } from "@/lib/settings/helpers";
import { nextDocNumber, ensureSeasonFor } from "@/lib/docs/sequences";
import { consumeStock, addStock, weightedCost, locationQty } from "@/lib/inventory/stock";
import { z } from "zod";
import { transferSchema, transferConfirmSchema, countSchema, lossSchema } from "@/lib/inventory/validation";

type Tx = Prisma.TransactionClient;

type TransferInput = z.infer<typeof transferSchema>;

async function locationsOrThrow(companyId: string, fromId: string, toId: string) {
  if (fromId === toId) throw Object.assign(new Error("same_location"), { status: 400 });
  const locs = await prisma.store.findMany({
    where: { id: { in: [fromId, toId] }, companyId, isActive: true },
    include: { user: { select: { role: true } } },
  });
  const from = locs.find((l) => l.id === fromId);
  const to = locs.find((l) => l.id === toId);
  if (!from || !to) throw Object.assign(new Error("bad_location"), { status: 400 });
  // A van driven by a Vendeur (مندوب) never holds stock: no transfer may
  // touch it, in either direction.
  for (const l of [from, to]) {
    if (l.kind === "VAN" && l.user?.role === "Vendeur") {
      throw Object.assign(new Error("vendeur_no_stock"), { status: 400 });
    }
  }
  return { from, to };
}

/// DECLARE: consume source FIFO/FEFO into in-transit holding batches.
/// Stock leaves source availability immediately; nothing reaches the dest yet.
export async function declareTransfer(
  companyId: string,
  userId: string,
  input: TransferInput,
  opts?: { opId?: string | null; occurredAt?: Date | null },
) {
  const settings = await getOrCreateSettings(companyId);
  const { from, to } = await locationsOrThrow(companyId, input.fromLocationId, input.toLocationId);
  // Vendeurs in LOCKED mode move stock only out of their own van.
  const actor = await prisma.user.findFirst({ where: { id: userId, companyId }, include: { assignedVans: { select: { id: true } } } });
  if (actor && actor.role === "Vendeur" && settings.vanBindingMode === "LOCKED") {
    // Every VAN side of the move must be owned (source and destination).
    const owned = new Set(actor.assignedVans.map((v) => v.id));
    for (const side of [from, to]) {
      if (side.kind === "VAN" && !owned.has(side.id)) {
        throw Object.assign(new Error("van_not_assigned"), { status: 403 });
      }
    }
  }
  if (from.kind === "DEPOT" && to.kind === "DEPOT" && !settings.multiDepotEnabled) {
    throw Object.assign(new Error("multidepot_disabled"), { status: 400 });
  }

  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  const products = await prisma.product.findMany({ where: { id: { in: productIds }, companyId } });
  if (products.length !== productIds.length) throw Object.assign(new Error("bad_product"), { status: 400 });

  // Colisage-only rule (pieceSalesEnabled OFF): packed products move between
  // locations in whole packs only — no loose leftovers in either direction.
  if (!settings.pieceSalesEnabled) {
    const convs = await prisma.productUnitConversion.findMany({ where: { productId: { in: productIds } } });
    for (const l of input.lines) {
      const packs = convs
        .filter((x) => x.productId === l.productId && Number(x.factor) > 1)
        .sort((a, b) => Number(a.factor) - Number(b.factor));
      if (!packs.length) continue;
      const f = Number(packs[0].factor);
      const whole = Math.round(Number(l.qty) / f);
      if (whole <= 0 || Math.abs(Number(l.qty) - whole * f) > 1e-9) {
        throw Object.assign(new Error("pack_only_qty"), { status: 400 });
      }
    }
  }

  const date = opts?.occurredAt ?? new Date();
  const season = await ensureSeasonFor(companyId, date);
  return prisma.$transaction(async (tx) => {
    const number = await nextDocNumber(tx, companyId, "transfer", date.getFullYear(), "TRF");
    const transfer = await tx.transfer.create({
      data: {
        companyId,
        seasonId: season.id,
        number,
        fromLocationId: from.id,
        toLocationId: to.id,
        cashAmount: input.cashAmount ?? 0,
        notes: input.notes ?? null,
        declaredById: userId,
        date,
        opId: opts?.opId ?? null,
      },
    });

    const created: Array<{ id: string; qty: number }> = [];
    for (const l of input.lines) {
      const consumed = await consumeStock(tx, {
        companyId,
        locationId: from.id,
        productId: l.productId,
        qty: l.qty,
        fefo: settings.expiryEnabled,
      });
      const line = await tx.transferLine.create({
        data: { transferId: transfer.id, productId: l.productId, declaredQty: l.qty },
      });
      // Holding batches preserve cost + earliest expiry for FEFO continuity.
      const expiries = await tx.stockBatch.findMany({
        where: { id: { in: consumed.map((c) => c.batchId) }, expiryDate: { not: null } },
        orderBy: { expiryDate: "asc" },
        take: 1,
      });
      await addStock(tx, {
        companyId,
        locationId: null,
        transferId: transfer.id,
        productId: l.productId,
        qty: l.qty,
        unitCost: weightedCost(consumed),
        expiryDate: expiries[0]?.expiryDate ?? null,
      });
      created.push({ id: line.id, qty: l.qty });
      const p = products.find((x) => x.id === l.productId)!;
      await tx.product.update({ where: { id: p.id }, data: { stockQty: { decrement: l.qty } } });
    }

    // Single-step: deliver straight to the destination when confirmation is OFF
    // company-wide, or when an ADMIN makes the transfer (nobody else needs to
    // approve the admin's own order). Drivers/vendeurs still wait for confirmation.
    if (!settings.transferConfirmRequired || actor?.role === "Admin") {
      await deliverHolding(tx, {
        companyId,
        transferId: transfer.id,
        fromLocationId: from.id,
        toLocationId: to.id,
        cashAmount: Number(input.cashAmount ?? 0),
        number,
        lineQtys: new Map(created.map((c) => [c.id, c.qty])),
        confirmedById: userId,
        season,
      });
    }

    return tx.transfer.findUniqueOrThrow({
      where: { id: transfer.id },
      include: { lines: { include: { product: true } }, fromLocation: true, toLocation: true },
    });
  });
}

/// Move in-transit holding → destination (possibly adjusted); leftovers go
/// back to source. Shared by manual confirm and single-step auto-deliver.
/// Also records the van cash handover when cashAmount > 0.
async function deliverHolding(
  tx: Tx,
  args: {
    companyId: string;
    transferId: string;
    fromLocationId: string;
    toLocationId: string;
    cashAmount: number;
    number: string;
    lineQtys: Map<string, number>;
    confirmedById: string;
    season: { id: string };
  }
) {
  const { companyId, transferId, fromLocationId, toLocationId, cashAmount, number, lineQtys, confirmedById, season } = args;
  const lines = await tx.transferLine.findMany({ where: { transferId } });
  for (const line of lines) {
    const confirmed = Math.min(lineQtys.get(line.id) ?? Number(line.declaredQty), Number(line.declaredQty));
    // Empty the holding for this product (FIFO within holding).
    const holding = await tx.stockBatch.findMany({
      where: { transferId, productId: line.productId, qty: { gt: 0 } },
      orderBy: { createdAt: "asc" },
    });
    let remaining = Number(line.declaredQty);
    let movedCost = 0;
    let movedQty = 0;
    for (const b of holding) {
      if (remaining <= 1e-9) break;
      const take = Math.min(Number(b.qty), remaining);
      await tx.stockBatch.update({ where: { id: b.id }, data: { qty: { decrement: take } } });
      movedCost += take * Number(b.unitCost);
      movedQty += take;
      remaining -= take;
    }
    const sendQty = Math.min(confirmed, movedQty);
    const backQty = movedQty - sendQty;
    const avgCost = movedQty > 0 ? movedCost / movedQty : 0;
    if (sendQty > 1e-9) {
      const h = holding.find((b) => b.expiryDate);
      await addStock(tx, {
        companyId,
        locationId: toLocationId,
        productId: line.productId,
        qty: sendQty,
        unitCost: avgCost,
        expiryDate: h?.expiryDate ?? null,
      });
      await tx.product.update({ where: { id: line.productId }, data: { stockQty: { increment: sendQty } } });
    }
    if (backQty > 1e-9) {
      const h = holding.find((b) => b.expiryDate);
      await addStock(tx, {
        companyId,
        locationId: fromLocationId,
        productId: line.productId,
        qty: backQty,
        unitCost: avgCost,
        expiryDate: h?.expiryDate ?? null,
      });
      await tx.product.update({ where: { id: line.productId }, data: { stockQty: { increment: backQty } } });
    }
    await tx.transferLine.update({ where: { id: line.id }, data: { confirmedQty: sendQty } });
  }
  await tx.transfer.update({ where: { id: transferId }, data: { status: "CONFIRMED", confirmedById } });
  // Van cash handover: auto-record the collection linked to this transfer.
  if (cashAmount > 0) {
    await tx.versement.create({
      data: {
        companyId,
        seasonId: season.id,
        kind: "CASH_COLLECTION",
        transferId,
        locationId: toLocationId,
        amount: cashAmount,
        notes: `Handover ${number}`,
      },
    });
  }
}

type ConfirmInput = z.infer<typeof transferConfirmSchema>;

/// CONFIRM: move holding → dest (possibly adjusted); leftovers return to source.
/// REJECT/CANCEL: everything returns to source at original cost.
/// Confirm is allowed for Admins and for the owner of the destination van
/// (so a vendeur confirms receipt on his phone); reject/cancel stay open.
export async function resolveTransfer(companyId: string, userId: string, transferId: string, input: ConfirmInput) {
  const settings = await getOrCreateSettings(companyId);
  const transfer = await prisma.transfer.findFirst({
    where: { id: transferId, companyId },
    include: { lines: true },
  });
  if (!transfer) throw Object.assign(new Error("not_found"), { status: 404 });
  // Idempotent confirm: a retried/duplicated offline confirm for an already
  // confirmed transfer is a success, not an error (crash-safe exactly-once).
  if (transfer.status === "CONFIRMED" && input.action === "confirm") {
    return prisma.transfer.findUniqueOrThrow({
      where: { id: transfer.id },
      include: { lines: { include: { product: true } }, fromLocation: true, toLocation: true },
    });
  }
  if (transfer.status !== "DECLARED") throw Object.assign(new Error("bad_status"), { status: 400 });
  if (input.action === "confirm") {
    const actor = await prisma.user.findFirst({ where: { id: userId, companyId }, include: { assignedVans: { select: { id: true } } } });
    const isAdmin = actor?.role === "Admin";
    const dest = await prisma.store.findFirst({ where: { id: transfer.toLocationId, companyId } });
    const ownsDest = dest?.kind === "VAN" && !!actor?.assignedVans.some((v) => v.id === dest.id);
    if (!isAdmin && !ownsDest) throw Object.assign(new Error("confirm_forbidden"), { status: 403 });
  }

  const confirmSeason = await ensureSeasonFor(companyId, new Date());
  return prisma.$transaction(async (tx) => {
    if (input.action === "confirm") {
      const number = transfer.number;
      await deliverHolding(tx, {
        companyId,
        transferId: transfer.id,
        fromLocationId: transfer.fromLocationId,
        toLocationId: transfer.toLocationId,
        cashAmount: Number(transfer.cashAmount),
        number,
        lineQtys: new Map((input.lines ?? []).map((l) => [l.lineId, l.confirmedQty])),
        confirmedById: userId,
        season: confirmSeason,
      });
    } else {
      // Return everything to source.
      const holding = await tx.stockBatch.findMany({ where: { transferId: transfer.id, qty: { gt: 0 } } });
      for (const b of holding) {
        await addStock(tx, {
          companyId,
          locationId: transfer.fromLocationId,
          productId: b.productId,
          qty: Number(b.qty),
          unitCost: Number(b.unitCost),
          expiryDate: b.expiryDate,
        });
        await tx.stockBatch.update({ where: { id: b.id }, data: { qty: 0 } });
        await tx.product.update({ where: { id: b.productId }, data: { stockQty: { increment: Number(b.qty) } } });
      }
      await tx.transfer.update({
        where: { id: transfer.id },
        data: { status: input.action === "reject" ? "REJECTED" : "CANCELLED", confirmedById: userId },
      });
    }
    void settings;
    return tx.transfer.findUniqueOrThrow({
      where: { id: transfer.id },
      include: { lines: { include: { product: true } }, fromLocation: true, toLocation: true },
    });
  });
}

type CountInput = z.infer<typeof countSchema>;

/// Create a draft count with expected quantities snapshotted from live batches.
export async function createCount(companyId: string, input: CountInput) {
  const loc = await prisma.store.findFirst({ where: { id: input.locationId, companyId } });
  if (!loc) throw Object.assign(new Error("bad_location"), { status: 400 });
  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  const products = await prisma.product.findMany({ where: { id: { in: productIds }, companyId } });
  if (products.length !== productIds.length) throw Object.assign(new Error("bad_product"), { status: 400 });

  const date = new Date();
  const season = await ensureSeasonFor(companyId, date);
  return prisma.$transaction(async (tx) => {
    const number = await nextDocNumber(tx, companyId, "count", date.getFullYear(), "INV");
    const count = await tx.stockCount.create({
      data: { companyId, seasonId: season.id, locationId: loc.id, number, notes: input.notes ?? null, date },
    });
    for (const l of input.lines) {
      const expected = await locationQty(tx, companyId, loc.id, l.productId);
      await tx.stockCountLine.create({ data: { countId: count.id, productId: l.productId, expectedQty: expected, countedQty: l.countedQty } });
    }
    return tx.stockCount.findUniqueOrThrow({ where: { id: count.id }, include: { lines: { include: { product: true } }, location: true } });
  });
}

/// Validate: surpluses create batches at current cost, shortages consume FIFO.
export async function validateCount(companyId: string, countId: string) {
  const settings = await getOrCreateSettings(companyId);
  const count = await count_find(companyId, countId);
  if (!count) throw Object.assign(new Error("not_found"), { status: 404 });
  if (count.status !== "DRAFT") throw Object.assign(new Error("bad_status"), { status: 400 });

  return prisma.$transaction(async (tx) => {
    for (const l of count.lines) {
      const diff = Number(l.countedQty) - Number(l.expectedQty);
      if (Math.abs(diff) < 1e-9) continue;
      if (diff > 0) {
        const p = await tx.product.findUniqueOrThrow({ where: { id: l.productId } });
        await addStock(tx, { companyId, locationId: count.locationId, productId: l.productId, qty: diff, unitCost: Number(p.costPrice) });
        await tx.product.update({ where: { id: l.productId }, data: { stockQty: { increment: diff } } });
      } else {
        await consumeStock(tx, { companyId, locationId: count.locationId, productId: l.productId, qty: -diff, fefo: settings.expiryEnabled });
        await tx.product.update({ where: { id: l.productId }, data: { stockQty: { decrement: -diff } } });
      }
    }
    await tx.stockCount.update({ where: { id: count.id }, data: { status: "VALIDATED" } });
    return tx.stockCount.findUniqueOrThrow({ where: { id: count.id }, include: { lines: { include: { product: true } }, location: true } });
  });
}

async function count_find(companyId: string, countId: string) {
  return prisma.stockCount.findFirst({ where: { id: countId, companyId }, include: { lines: true } });
}

type LossInput = z.infer<typeof lossSchema>;

export async function createLoss(companyId: string, input: LossInput) {
  const settings = await getOrCreateSettings(companyId);
  const [loc, product] = await Promise.all([
    prisma.store.findFirst({ where: { id: input.locationId, companyId } }),
    prisma.product.findFirst({ where: { id: input.productId, companyId } }),
  ]);
  if (!loc || !product) throw Object.assign(new Error("bad_ref"), { status: 400 });

  const season = await ensureSeasonFor(companyId, new Date());
  return prisma.$transaction(async (tx) => {
    await consumeStock(tx, { companyId, locationId: loc.id, productId: product.id, qty: input.baseQty, fefo: settings.expiryEnabled });
    await tx.product.update({ where: { id: product.id }, data: { stockQty: { decrement: input.baseQty } } });
    return tx.stockLoss.create({
      data: {
        companyId,
        seasonId: season.id,
        locationId: loc.id,
        productId: product.id,
        baseQty: input.baseQty,
        motive: input.motive,
        notes: input.notes ?? null,
      },
    });
  });
}
