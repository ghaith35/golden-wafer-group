import { prisma } from "@/lib/db";
import { getOrCreateSettings } from "@/lib/settings/helpers";

/// Reference data for the purchase invoice editor.
/// Shared by the /new route and the purchases-list creation modal.
export async function getPurchaseFormData(companyId: string) {
  const [suppliers, products, units, tiers, settings, locations, categories] = await Promise.all([
    prisma.supplier.findMany({ where: { companyId, isActive: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({
      where: { companyId, isActive: true },
      include: {
        baseUnit: true,
        conversions: { include: { unit: true } },
        images: { orderBy: { sortOrder: "asc" }, take: 1 },
        tierPrices: { include: { tier: true } },
      },
      orderBy: { name: "asc" },
      take: 500,
    }),
    prisma.unit.findMany({ where: { companyId, isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.priceTier.findMany({ where: { companyId, isActive: true }, orderBy: { sortOrder: "asc" } }),
    getOrCreateSettings(companyId),
    prisma.store.findMany({ where: { companyId, isActive: true }, orderBy: { name: "asc" } }),
    prisma.productCategory.findMany({ where: { companyId }, orderBy: { name: "asc" } }),
  ]);
  return {
    suppliers: JSON.parse(JSON.stringify(suppliers)),
    products: JSON.parse(JSON.stringify(products)).map((p: Record<string, unknown>) => ({
      ...p,
      costPrice: Number((p as { costPrice: unknown }).costPrice),
      salePrice: Number((p as { salePrice: unknown }).salePrice ?? 0),
      tierPrices: ((p as { tierPrices: Array<{ price: unknown }> }).tierPrices ?? []).map((x) => ({ ...x, price: Number(x.price) })),
    })),
    units: JSON.parse(JSON.stringify(units)),
    tiers: JSON.parse(JSON.stringify(tiers)),
    locations: JSON.parse(JSON.stringify(locations)),
    categories: JSON.parse(JSON.stringify(categories)),
    settings: JSON.parse(JSON.stringify(settings)),
  };
}

export type PurchaseFormData = Awaited<ReturnType<typeof getPurchaseFormData>>;
