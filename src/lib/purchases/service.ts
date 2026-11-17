import { prisma } from "@/lib/db";
import { getOrCreateSettings } from "@/lib/settings/helpers";
import { nextDocNumber, ensureSeasonFor } from "@/lib/docs/sequences";
import { z } from "zod";
import { purchaseSchema, supplierReturnSchema } from "@/lib/products/validation";

type PurchaseInput = z.infer<typeof purchaseSchema>;

import { mainDepotName as depotName } from "@/lib/inventory/depot";
function mainDepotName(settings: { defaultLocale?: string | null }): string {
  return depotName(settings.defaultLocale);
}

/// Direct supplier invoice entry → batches + stock + supplier debt.
/// Costing follows Settings.costingMethod (LAST / AVERAGE / FIFO).
export async function createPurchase(companyId: string, input: PurchaseInput) {
  const settings = await getOrCreateSettings(companyId);
  if (!settings.remiseEnabled && ((input.remise ?? 0) > 0 || input.lines.some((l) => (l.remise ?? 0) > 0))) {
    throw Object.assign(new Error("remise_disabled"), { status: 400 });
  }

  const supplier = await prisma.supplier.findFirst({ where: { id: input.supplierId, companyId } });
  if (!supplier) throw Object.assign(new Error("bad_supplier"), { status: 400 });

  // Receiving location: given, else the main depot (auto-created).
  let location = input.locationId
    ? await prisma.store.findFirst({ where: { id: input.locationId, companyId } })
    : await prisma.store.findFirst({ where: { companyId, kind: "DEPOT" }, orderBy: { createdAt: "asc" } });
  if (!location && !input.locationId) {
    location = await prisma.store.create({ data: { companyId, name: mainDepotName(settings), kind: "DEPOT" } });
  }
  if (!location) throw Object.assign(new Error("bad_location"), { status: 400 });

  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  const products = await prisma.product.findMany({ where: { id: { in: productIds }, companyId } });
  if (products.length !== productIds.length) throw Object.assign(new Error("bad_product"), { status: 400 });
  const byId = new Map(products.map((p) => [p.id, p]));

  const conversions = await prisma.productUnitConversion.findMany({ where: { productId: { in: productIds } } });
  const factorOf = (productId: string, unitId: string | null | undefined): number => {
    if (!unitId) return 1;
    // The base unit is factor 1 by definition — it has no conversion row.
    if (byId.get(productId)?.baseUnitId === unitId) return 1;
    const c = conversions.find((x) => x.productId === productId && x.unitId === unitId);
    if (!c) throw Object.assign(new Error("bad_unit"), { status: 400 });
    const f = Number(c.factor);
    // Sub-base units (1 piece = 1/N base) normalize to exact 1/N.
    return f < 1 ? 1 / Math.round(1 / f) : f;
  };

  const date = input.date ? new Date(input.date) : new Date();
  if (Number.isNaN(date.getTime())) throw Object.assign(new Error("bad_date"), { status: 400 });

  const tierIds = [...new Set(input.lines.flatMap((l) => (l.tierPrices ?? []).map((x) => x.tierId)))];
  if (tierIds.length) {
    const tiers = await prisma.priceTier.findMany({ where: { id: { in: tierIds }, companyId } });
    if (tiers.length !== tierIds.length) throw Object.assign(new Error("bad_tier"), { status: 400 });
  }
  const computed = input.lines.map((l) => {
    const factor = factorOf(l.productId, l.unitId);
    const baseQty = (l.qty + (l.freeQty ?? 0)) * factor;
    const lineTotal = Math.max(0, l.qty * l.unitPrice - (l.remise ?? 0));
    const saleBase = l.salePrice != null && factor > 0 ? l.salePrice / factor : null;
    const tiersBase = (l.tierPrices ?? []).map((x) => ({ tierId: x.tierId, price: factor > 0 ? x.price / factor : x.price }));
    return { ...l, factor, baseQty, lineTotal, saleBase, tiersBase, freeQty: l.freeQty ?? 0, remise: l.remise ?? 0 };
  });
  const linesTotal = computed.reduce((s, l) => s + l.lineTotal, 0);
  const total = Math.max(0, linesTotal - (input.remise ?? 0));
  const trackExpiry = settings.expiryEnabled;

  const season = await ensureSeasonFor(companyId, date);
  return prisma.$transaction(async (tx) => {
    const number = await nextDocNumber(tx, companyId, "purchase_invoice", date.getFullYear());

    const invoice = await tx.purchaseInvoice.create({
      data: {
        companyId,
        seasonId: season.id,
        supplierId: supplier.id,
        number,
        date,
        remise: input.remise ?? 0,
        total,
        notes: input.notes ?? null,
      },
    });

    for (const l of computed) {
      const unitCost = l.baseQty > 0 ? l.lineTotal / l.baseQty : 0;
      const batch = await tx.stockBatch.create({
        data: {
          companyId,
          productId: l.productId,
          storeId: location.id,
          qty: l.baseQty,
          initialQty: l.baseQty,
          unitCost,
          expiryDate: trackExpiry && l.expiryDate ? new Date(l.expiryDate) : null,
        },
      });
      await tx.purchaseLine.create({
        data: {
          invoiceId: invoice.id,
          productId: l.productId,
          unitId: l.unitId ?? null,
          qty: l.qty,
          freeQty: l.freeQty,
          baseQty: l.baseQty,
          unitPrice: l.unitPrice,
          remise: l.remise,
          lineTotal: l.lineTotal,
          expiryDate: trackExpiry && l.expiryDate ? new Date(l.expiryDate) : null,
          batchId: batch.id,
        },
      });
    }

    // Stock + costing per product.
    for (const p of products) {
      const lines = computed.filter((l) => l.productId === p.id);
      const inQty = lines.reduce((s, l) => s + l.baseQty, 0);
      const inTotal = lines.reduce((s, l) => s + l.lineTotal, 0);
      const oldStock = Number(p.stockQty);
      const oldCost = Number(p.costPrice);
      let newCost = oldCost;
      if (settings.costingMethod === "LAST") {
        const last = lines[lines.length - 1];
        newCost = last.baseQty > 0 ? last.lineTotal / last.baseQty : oldCost;
      } else if (settings.costingMethod === "AVERAGE") {
        newCost = oldStock + inQty > 0 ? (oldStock * oldCost + inTotal) / (oldStock + inQty) : oldCost;
      } else {
        const oldest = await tx.stockBatch.findFirst({
          where: { productId: p.id, qty: { gt: 0 } },
          orderBy: { createdAt: "asc" },
        });
        if (oldest) newCost = Number(oldest.unitCost);
      }
      const lastSale = [...lines].reverse().find((l) => l.saleBase != null);
      await tx.product.update({
        where: { id: p.id },
        data: {
          stockQty: { increment: inQty },
          costPrice: newCost,
          ...(lastSale?.saleBase != null ? { salePrice: lastSale.saleBase } : {}),
        },
      });
      for (const l of lines) {
        for (const tp of l.tiersBase) {
          await tx.productTierPrice.upsert({
            where: { productId_tierId: { productId: p.id, tierId: tp.tierId } },
            update: { price: tp.price },
            create: { productId: p.id, tierId: tp.tierId, price: tp.price },
          });
        }
      }
      void byId;
    }

    await tx.supplier.update({ where: { id: supplier.id }, data: { balance: { increment: total } } });

    // Amount handed over with the invoice: linked SUPPLIER_PAYMENT versement,
    // invoice.paid set, supplier debt reduced — same books as paying later.
    const upfront = Math.round((input.paid ?? 0) * 100) / 100;
    if (upfront > total + 1e-9) throw Object.assign(new Error("overpayment"), { status: 400 });
    if (upfront > 0) {
      await tx.versement.create({
        data: {
          companyId,
          seasonId: season.id,
          kind: "SUPPLIER_PAYMENT",
          supplierId: supplier.id,
          purchaseInvoiceId: invoice.id,
          amount: upfront,
          date,
          notes: input.notes ?? null,
        },
      });
      await tx.supplier.update({ where: { id: supplier.id }, data: { balance: { decrement: upfront } } });
      await tx.purchaseInvoice.update({ where: { id: invoice.id }, data: { paid: { increment: upfront } } });
    }

    return tx.purchaseInvoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: { lines: { include: { product: true } }, supplier: true },
    });
  });
}

type ReturnInput = z.infer<typeof supplierReturnSchema>;
/// Return to supplier: consume batches FIFO, reverse stock, credit supplier balance.
export async function createSupplierReturn(companyId: string, input: ReturnInput) {
  const supplier = await prisma.supplier.findFirst({ where: { id: input.supplierId, companyId } });
  if (!supplier) throw Object.assign(new Error("bad_supplier"), { status: 400 });

  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  const products = await prisma.product.findMany({ where: { id: { in: productIds }, companyId } });
  if (products.length !== productIds.length) throw Object.assign(new Error("bad_product"), { status: 400 });

  const date = new Date();
  const total = input.lines.reduce((s, l) => s + l.baseQty * l.unitPrice, 0);

  const season = await ensureSeasonFor(companyId, date);
  return prisma.$transaction(async (tx) => {
    const number = await nextDocNumber(tx, companyId, "supplier_return", date.getFullYear());

    // Availability check first (fail fast before mutating).
    for (const l of input.lines) {
      const p = products.find((x) => x.id === l.productId)!;
      if (Number(p.stockQty) < l.baseQty) throw Object.assign(new Error("insufficient_stock"), { status: 400 });
    }

    const ret = await tx.supplierReturn.create({
      data: {
        companyId,
        seasonId: season.id,
        supplierId: supplier.id,
        invoiceId: input.invoiceId ?? null,
        number,
        date,
        total,
        notes: input.notes ?? null,
      },
    });

    for (const l of input.lines) {
      await tx.supplierReturnLine.create({
        data: {
          returnId: ret.id,
          productId: l.productId,
          baseQty: l.baseQty,
          unitPrice: l.unitPrice,
          lineTotal: l.baseQty * l.unitPrice,
        },
      });
      // Consume oldest batches first (scoped to this company).
      let remaining = l.baseQty;
      const batches = await tx.stockBatch.findMany({
        where: { companyId, productId: l.productId, qty: { gt: 0 } },
        orderBy: { createdAt: "asc" },
      });
      for (const b of batches) {
        if (remaining <= 0) break;
        const take = Math.min(Number(b.qty), remaining);
        await tx.stockBatch.update({ where: { id: b.id }, data: { qty: { decrement: take } } });
        remaining -= take;
      }
      await tx.product.update({ where: { id: l.productId }, data: { stockQty: { decrement: l.baseQty } } });
    }

    await tx.supplier.update({ where: { id: supplier.id }, data: { balance: { decrement: total } } });

    return tx.supplierReturn.findUniqueOrThrow({
      where: { id: ret.id },
      include: { lines: { include: { product: true } }, supplier: true },
    });
  });
}

/// Full modify of a purchase invoice: reverse the old lines, then re-apply
/// the new document as posted. The invoice number is preserved; stock,
/// batches, costing, tier/sale prices and supplier balance are recomputed.
/// Same guards as delete: every old batch must still hold its received
/// quantity (else goods moved since → correct via a supplier return), and
/// no linked returns may exist.
export async function updatePurchase(companyId: string, id: string, input: PurchaseInput) {
  const settings = await getOrCreateSettings(companyId);
  if (!settings.remiseEnabled && ((input.remise ?? 0) > 0 || input.lines.some((l) => (l.remise ?? 0) > 0))) {
    throw Object.assign(new Error("remise_disabled"), { status: 400 });
  }

  const existing = await prisma.purchaseInvoice.findFirst({
    where: { id, companyId },
    include: { lines: true },
  });
  if (!existing) throw Object.assign(new Error("not_found"), { status: 404 });

  const linkedReturns = await prisma.supplierReturn.count({ where: { companyId, invoiceId: id } });
  if (linkedReturns > 0) throw Object.assign(new Error("has_returns"), { status: 400 });

  const supplier = await prisma.supplier.findFirst({ where: { id: input.supplierId, companyId } });
  if (!supplier) throw Object.assign(new Error("bad_supplier"), { status: 400 });

  let location = input.locationId
    ? await prisma.store.findFirst({ where: { id: input.locationId, companyId } })
    : await prisma.store.findFirst({ where: { companyId, kind: "DEPOT" }, orderBy: { createdAt: "asc" } });
  if (!location && !input.locationId) {
    location = await prisma.store.create({ data: { companyId, name: mainDepotName(settings), kind: "DEPOT" } });
  }
  if (!location) throw Object.assign(new Error("bad_location"), { status: 400 });

  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  const products = await prisma.product.findMany({ where: { id: { in: productIds }, companyId } });
  if (products.length !== productIds.length) throw Object.assign(new Error("bad_product"), { status: 400 });
  const baseOf = new Map(products.map((p) => [p.id, p.baseUnitId ?? null]));

  const conversions = await prisma.productUnitConversion.findMany({ where: { productId: { in: productIds } } });
  const factorOf = (productId: string, unitId: string | null | undefined): number => {
    if (!unitId) return 1;
    // The base unit is factor 1 by definition — it has no conversion row.
    if (baseOf.get(productId) === unitId) return 1;
    const c = conversions.find((x) => x.productId === productId && x.unitId === unitId);
    if (!c) throw Object.assign(new Error("bad_unit"), { status: 400 });
    const f = Number(c.factor);
    return f < 1 ? 1 / Math.round(1 / f) : f;
  };

  const date = input.date ? new Date(input.date) : new Date();
  if (Number.isNaN(date.getTime())) throw Object.assign(new Error("bad_date"), { status: 400 });

  const tierIds = [...new Set(input.lines.flatMap((l) => (l.tierPrices ?? []).map((x) => x.tierId)))];
  if (tierIds.length) {
    const tiers = await prisma.priceTier.findMany({ where: { id: { in: tierIds }, companyId } });
    if (tiers.length !== tierIds.length) throw Object.assign(new Error("bad_tier"), { status: 400 });
  }
  const computed = input.lines.map((l) => {
    const factor = factorOf(l.productId, l.unitId);
    const baseQty = (l.qty + (l.freeQty ?? 0)) * factor;
    const lineTotal = Math.max(0, l.qty * l.unitPrice - (l.remise ?? 0));
    const saleBase = l.salePrice != null && factor > 0 ? l.salePrice / factor : null;
    const tiersBase = (l.tierPrices ?? []).map((x) => ({ tierId: x.tierId, price: factor > 0 ? x.price / factor : x.price }));
    return { ...l, factor, baseQty, lineTotal, saleBase, tiersBase, freeQty: l.freeQty ?? 0, remise: l.remise ?? 0 };
  });
  const linesTotal = computed.reduce((s, l) => s + l.lineTotal, 0);
  const total = Math.max(0, linesTotal - (input.remise ?? 0));
  const trackExpiry = settings.expiryEnabled;
  const season = await ensureSeasonFor(companyId, date);

  // Old received quantities per product (for AVERAGE re-anchoring below).
  const reversedByProduct = new Map<string, number>();
  for (const l of existing.lines) {
    reversedByProduct.set(l.productId, (reversedByProduct.get(l.productId) ?? 0) + Number(l.baseQty));
  }

  return prisma.$transaction(async (tx) => {
    // Fail fast: old batches must still cover their line quantities.
    for (const l of existing.lines) {
      if (!l.batchId) throw Object.assign(new Error("no_batch"), { status: 400 });
      const batch = await tx.stockBatch.findUnique({ where: { id: l.batchId } });
      if (!batch || Number(batch.qty) < Number(l.baseQty)) {
        throw Object.assign(new Error("insufficient_stock"), { status: 400 });
      }
    }
    // Reverse the old posting.
    for (const l of existing.lines) {
      await tx.stockBatch.delete({ where: { id: l.batchId! } });
      await tx.product.update({ where: { id: l.productId }, data: { stockQty: { decrement: l.baseQty } } });
      await tx.purchaseLine.delete({ where: { id: l.id } });
    }
    await tx.supplier.update({ where: { id: existing.supplierId }, data: { balance: { decrement: existing.total } } });

    // Apply the new document (same posting as create).
    await tx.purchaseInvoice.update({
      where: { id },
      data: {
        supplierId: supplier.id,
        seasonId: season.id,
        date,
        remise: input.remise ?? 0,
        total,
        notes: input.notes ?? null,
      },
    });

    for (const l of computed) {
      const unitCost = l.baseQty > 0 ? l.lineTotal / l.baseQty : 0;
      const batch = await tx.stockBatch.create({
        data: {
          companyId,
          productId: l.productId,
          storeId: location.id,
          qty: l.baseQty,
          initialQty: l.baseQty,
          unitCost,
          expiryDate: trackExpiry && l.expiryDate ? new Date(l.expiryDate) : null,
        },
      });
      await tx.purchaseLine.create({
        data: {
          invoiceId: id,
          productId: l.productId,
          unitId: l.unitId ?? null,
          qty: l.qty,
          freeQty: l.freeQty,
          baseQty: l.baseQty,
          unitPrice: l.unitPrice,
          remise: l.remise,
          lineTotal: l.lineTotal,
          expiryDate: trackExpiry && l.expiryDate ? new Date(l.expiryDate) : null,
          batchId: batch.id,
        },
      });
    }

    for (const p of products) {
      const lines = computed.filter((l) => l.productId === p.id);
      const inQty = lines.reduce((s, l) => s + l.baseQty, 0);
      const inTotal = lines.reduce((s, l) => s + l.lineTotal, 0);
      // Snapshot stock includes the old receipt → subtract it first.
      const oldStock = Number(p.stockQty) - (reversedByProduct.get(p.id) ?? 0);
      const oldCost = Number(p.costPrice);
      let newCost = oldCost;
      if (settings.costingMethod === "LAST") {
        const last = lines[lines.length - 1];
        newCost = last.baseQty > 0 ? last.lineTotal / last.baseQty : oldCost;
      } else if (settings.costingMethod === "AVERAGE") {
        newCost = oldStock + inQty > 0 ? (oldStock * oldCost + inTotal) / (oldStock + inQty) : oldCost;
      } else {
        const oldest = await tx.stockBatch.findFirst({
          where: { productId: p.id, qty: { gt: 0 } },
          orderBy: { createdAt: "asc" },
        });
        if (oldest) newCost = Number(oldest.unitCost);
      }
      const lastSale = [...lines].reverse().find((l) => l.saleBase != null);
      await tx.product.update({
        where: { id: p.id },
        data: {
          stockQty: { increment: inQty },
          costPrice: newCost,
          ...(lastSale?.saleBase != null ? { salePrice: lastSale.saleBase } : {}),
        },
      });
      for (const l of lines) {
        for (const tp of l.tiersBase) {
          await tx.productTierPrice.upsert({
            where: { productId_tierId: { productId: p.id, tierId: tp.tierId } },
            update: { price: tp.price },
            create: { productId: p.id, tierId: tp.tierId, price: tp.price },
          });
        }
      }
    }

    await tx.supplier.update({ where: { id: supplier.id }, data: { balance: { increment: total } } });

    return tx.purchaseInvoice.findUniqueOrThrow({
      where: { id },
      include: { lines: { include: { product: true } }, supplier: true },
    });
  });
}

/// Delete a purchase invoice, fully reversing it: every line batch must still
/// hold its received quantity (otherwise something was sold/transferred since
/// and the invoice can only be corrected via a supplier return).
export async function deletePurchase(companyId: string, id: string) {
  const invoice = await prisma.purchaseInvoice.findFirst({
    where: { id, companyId },
    include: { lines: true },
  });
  if (!invoice) throw Object.assign(new Error("not_found"), { status: 404 });

  const linkedReturns = await prisma.supplierReturn.count({ where: { companyId, invoiceId: id } });
  if (linkedReturns > 0) throw Object.assign(new Error("has_returns"), { status: 400 });

  return prisma.$transaction(async (tx) => {
    // Fail fast: all batches must still cover their line quantities.
    for (const l of invoice.lines) {
      if (!l.batchId) throw Object.assign(new Error("no_batch"), { status: 400 });
      const batch = await tx.stockBatch.findUnique({ where: { id: l.batchId } });
      if (!batch || Number(batch.qty) < Number(l.baseQty)) {
        throw Object.assign(new Error("insufficient_stock"), { status: 400 });
      }
    }
    for (const l of invoice.lines) {
      await tx.stockBatch.delete({ where: { id: l.batchId! } });
      await tx.product.update({ where: { id: l.productId }, data: { stockQty: { decrement: l.baseQty } } });
      await tx.purchaseLine.delete({ where: { id: l.id } });
    }
    // NOTE: product costPrice is left as-is (recomputing history is approximate;
    // the next purchase re-anchors it per the costing method).
    await tx.supplier.update({ where: { id: invoice.supplierId }, data: { balance: { decrement: invoice.total } } });
    await tx.purchaseInvoice.delete({ where: { id } });
    return { ok: true };
  });
}
