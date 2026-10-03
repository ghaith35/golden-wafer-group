import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export type Consumed = { batchId: string; qty: number; unitCost: number };

/// Consume qty from location batches: FIFO (createdAt) or FEFO (earliest expiry first).
/// Throws insufficient_stock. Holding batches (transferId set) are never touched.
export async function consumeStock(
  tx: Tx,
  opts: { companyId: string; locationId: string; productId: string; qty: number; fefo: boolean },
): Promise<Consumed[]> {
  const batches = await tx.stockBatch.findMany({
    where: { companyId: opts.companyId, productId: opts.productId, storeId: opts.locationId, transferId: null, qty: { gt: 0 } },
    orderBy: opts.fefo
      ? [{ expiryDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }]
      : { createdAt: "asc" },
  });
  const available = batches.reduce((s, b) => s + Number(b.qty), 0);
  if (available < opts.qty - 1e-9) {
    throw Object.assign(new Error("insufficient_stock"), { status: 400, available });
  }
  const out: Consumed[] = [];
  let remaining = opts.qty;
  for (const b of batches) {
    if (remaining <= 1e-9) break;
    const take = Math.min(Number(b.qty), remaining);
    await tx.stockBatch.update({ where: { id: b.id }, data: { qty: { decrement: take } } });
    out.push({ batchId: b.id, qty: take, unitCost: Number(b.unitCost) });
    remaining -= take;
  }
  return out;
}

export async function addStock(
  tx: Tx,
  opts: {
    companyId: string;
    locationId: string | null;
    transferId?: string | null;
    productId: string;
    qty: number;
    unitCost: number;
    expiryDate?: Date | null;
  },
) {
  return tx.stockBatch.create({
    data: {
      companyId: opts.companyId,
      productId: opts.productId,
      storeId: opts.locationId,
      transferId: opts.transferId ?? null,
      qty: opts.qty,
      initialQty: opts.qty,
      unitCost: opts.qty > 0 ? opts.unitCost : 0,
      expiryDate: opts.expiryDate ?? null,
    },
  });
}

export function weightedCost(consumed: Consumed[]): number {
  const qty = consumed.reduce((s, c) => s + c.qty, 0);
  if (qty <= 0) return 0;
  return consumed.reduce((s, c) => s + c.qty * c.unitCost, 0) / qty;
}

export async function locationQty(tx: Tx, companyId: string, locationId: string, productId: string): Promise<number> {
  const agg = await tx.stockBatch.aggregate({
    where: { companyId, productId, storeId: locationId, transferId: null },
    _sum: { qty: true },
  });
  return Number(agg._sum.qty ?? 0);
}
