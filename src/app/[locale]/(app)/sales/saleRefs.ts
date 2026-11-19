import { prisma } from "@/lib/db";
import { getOrCreateSettings } from "@/lib/settings/helpers";

/// Reference data for the sale document editor (order/ticket).
/// Shared by the /new routes and the sales-list creation modals.
export async function getSaleFormData(companyId: string) {
  const [clients, products, units, tiers, locations, settings] = await Promise.all([
    prisma.customer.findMany({ where: { companyId, isActive: true }, orderBy: { name: "asc" }, take: 500 }),
    prisma.product.findMany({
      where: { companyId, isActive: true },
      include: { baseUnit: true, conversions: { include: { unit: true } }, tierPrices: true, images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } }, category: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
      take: 500,
    }),
    prisma.unit.findMany({ where: { companyId, isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.priceTier.findMany({ where: { companyId, isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.store.findMany({ where: { companyId, isActive: true }, include: { user: { select: { role: true } } }, orderBy: { name: "asc" } }),
    getOrCreateSettings(companyId),
  ]);
  return {
    clients: JSON.parse(JSON.stringify(clients)).map((c: { balance: unknown } & Record<string, unknown>) => ({ ...c, balance: Number(c.balance) })),
    products: JSON.parse(JSON.stringify(products)).map((p: { salePrice: unknown; tierPrices: Array<{ price: unknown }> } & Record<string, unknown>) => ({
      ...p,
      salePrice: Number(p.salePrice),
      tierPrices: p.tierPrices.map((x) => ({ ...x, price: Number(x.price) })),
    })),
    units: JSON.parse(JSON.stringify(units)),
    tiers: JSON.parse(JSON.stringify(tiers)),
    locations: JSON.parse(JSON.stringify(locations)).map((l: { kind: string; user?: { role?: string } | null } & Record<string, unknown>) => ({ ...l, noStock: l.kind === "VAN" && l.user?.role === "Vendeur" })),
    settings: JSON.parse(JSON.stringify(settings)),
  };
}

export type SaleFormData = Awaited<ReturnType<typeof getSaleFormData>>;
