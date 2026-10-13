import { prisma } from "@/lib/db";

export type VanHold = {
  productId: string;
  productName: string;
  held: number;
  vanStock: number;
  free: number;
  orders: Array<{ id: string; number: string; clientName: string; qty: number }>;
  /// Smallest pack above base (for "100 كرتون + 5 قطعة" breakdowns).
  pack: { name: string; factor: number } | null;
  baseUnit: string;
};

/// Depot catalogue row for depot-only viewers (Vendeur): products the van
/// never held, so they exist nowhere in the holds list above.
export type DepotProduct = {
  productId: string;
  name: string;
  pack: { name: string; factor: number } | null;
  baseUnit: string;
};

/// Stock held for confirmed commandes assigned to a van (livreur view).
/// No schema change: held = Σ baseQty of CONFIRMED ORDER lines per product;
/// free = van batch stock − held (may go negative on oversell).
export async function vanHolds(
  companyId: string,
  vanId: string
): Promise<{ holds: VanHold[]; depot: Array<{ productId: string; qty: number }>; depotProducts: DepotProduct[] }> {
  const [orders, batches, depotBatches] = await Promise.all([
    prisma.sale.findMany({
      where: { companyId, kind: "ORDER", status: "CONFIRMED", locationId: vanId },
      include: {
        client: { select: { name: true } },
        lines: { include: { product: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.stockBatch.groupBy({
      by: ["productId"],
      where: { companyId, storeId: vanId, transferId: null },
      _sum: { qty: true },
    }),
    prisma.stockBatch.groupBy({
      by: ["productId"],
      where: { companyId, transferId: null, location: { kind: "DEPOT" } },
      _sum: { qty: true },
    }),
  ]);

  const stock = new Map(batches.map((b) => [b.productId, Number(b._sum.qty ?? 0)]));
  const byProduct = new Map<string, VanHold>();
  for (const o of orders) {
    for (const l of o.lines) {
      const qty = Number(l.baseQty);
      if (qty <= 0) continue;
      const e = byProduct.get(l.productId) ?? {
        productId: l.productId,
        productName: l.product.name,
        held: 0,
        vanStock: 0,
        free: 0,
        orders: [],
        pack: null,
        baseUnit: "",
      };
      e.held += qty;
      e.orders.push({ id: o.id, number: o.number, clientName: o.client?.name ?? "—", qty });
      byProduct.set(l.productId, e);
    }
  }
  // Free-to-sell rows for stocked products without holds too.
  const missing = [...stock.keys()].filter((pid) => !byProduct.has(pid) && (stock.get(pid) ?? 0) > 1e-9);
  if (missing.length) {
    const names = await prisma.product.findMany({ where: { id: { in: missing } }, select: { id: true, name: true } });
    const byId = new Map(names.map((p) => [p.id, p.name]));
    for (const pid of missing) {
      const q = stock.get(pid) ?? 0;
      byProduct.set(pid, { productId: pid, productName: byId.get(pid) ?? pid.slice(-4), held: 0, vanStock: q, free: q, orders: [], pack: null, baseUnit: "" });
    }
  }
  for (const e of byProduct.values()) {
    e.vanStock = stock.get(e.productId) ?? 0;
    e.free = e.vanStock - e.held;
  }
  // Pack info for breakdowns ("100 كرتون + 5 قطعة", "1 كرتون = 24 قطعة").
  const prods = await prisma.product.findMany({
    where: { id: { in: [...byProduct.keys()] } },
    select: {
      id: true,
      baseUnit: { select: { name: true } },
      conversions: { include: { unit: true } },
    },
  });
  for (const p of prods) {
    const e = byProduct.get(p.id);
    if (!e) continue;
    e.baseUnit = p.baseUnit?.name ?? "";
    const pack = (p.conversions ?? [])
      .filter((c) => Number(c.factor) > 1)
      .sort((a, b) => Number(a.factor) - Number(b.factor))[0];
    e.pack = pack ? { name: pack.unit.name, factor: Number(pack.factor) } : null;
  }
  const holds = [...byProduct.values()].sort((a, b) => b.held - a.held);
  // Depot catalogue for depot-only viewers (Vendeur stock screen): every
  // stocked depot product with its display info — independent of the van,
  // whose holds list is empty for a vendeur van and would show NOTHING.
  const depotIds = [...new Set(depotBatches.map((b) => b.productId))].filter((id) => !byProduct.has(id));
  let depotProducts: Array<{ productId: string; name: string; pack: { name: string; factor: number } | null; baseUnit: string }> = [];
  if (depotIds.length) {
    const dprods = await prisma.product.findMany({
      where: { id: { in: depotIds } },
      select: {
        id: true,
        name: true,
        baseUnit: { select: { name: true } },
        conversions: { include: { unit: true } },
      },
    });
    depotProducts = dprods.map((p) => {
      const pack = (p.conversions ?? [])
        .filter((c) => Number(c.factor) > 1)
        .sort((a, b) => Number(a.factor) - Number(b.factor))[0];
      return {
        productId: p.id,
        name: p.name,
        pack: pack ? { name: pack.unit.name, factor: Number(pack.factor) } : null,
        baseUnit: p.baseUnit?.name ?? "",
      };
    });
  }
  return {
    holds,
    depot: depotBatches.map((b) => ({ productId: b.productId, qty: Number(b._sum.qty ?? 0) })),
    depotProducts,
  };
}
