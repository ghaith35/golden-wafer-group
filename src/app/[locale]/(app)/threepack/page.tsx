import { setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getOrCreateSettings } from "@/lib/settings/helpers";
import { colisOf } from "@/lib/threepack/match";
import { listRulesForAdmin } from "@/lib/threepack/admin";
import { sortByName } from "@/lib/sort";
import { ThreePackClient } from "./ThreePackClient";

/// Gifted pack admin: free-colis rules. Toggle-gated (Settings → Sales) and admin-only.
export default async function ThreePackPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  if (session.role !== "Admin") redirect(`/${locale}/sales`);
  const settings = await getOrCreateSettings(session.companyId);
  if (!settings.threePackEnabled) redirect(`/${locale}/sales`);

  const [products, categories, rules] = await Promise.all([
    prisma.product.findMany({
      where: { companyId: session.companyId, isActive: true },
      select: {
        id: true,
        name: true,
        reference: true,
        baseUnitId: true,
        baseUnit: { select: { name: true } },
        category: { select: { id: true, name: true } },
        images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
        conversions: { select: { unitId: true, factor: true, unit: { select: { name: true } } } },
      },
      orderBy: { name: "asc" },
      take: 2000,
    }),
    prisma.productCategory.findMany({ where: { companyId: session.companyId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    listRulesForAdmin(session.companyId),
  ]);

  // Only products sold by colis can be used in a rule. The label tells the admin
  // what "1 colis" is for that product (e.g. "Carton × 12").
  const withColis = products.flatMap((p) => {
    const convs = p.conversions.map((c) => ({ unitId: c.unitId, factor: Number(c.factor) }));
    const colis = colisOf({ baseUnitId: p.baseUnitId, conversions: convs });
    if (!colis) return [];
    const unitName = colis.factor > 1 ? p.conversions.find((c) => c.unitId === colis.unitId)?.unit.name : p.baseUnit?.name;
    return [
      {
        id: p.id,
        name: p.name,
        reference: p.reference,
        imageUrl: p.images[0]?.url ?? null,
        category: p.category,
        colisLabel: unitName ? (colis.factor > 1 ? `${unitName} × ${colis.factor}` : unitName) : null,
      },
    ];
  });

  return (
    <ThreePackClient
      locale={locale}
      products={sortByName(withColis, locale)}
      categories={sortByName(categories, locale)}
      initialRules={rules}
    />
  );
}
