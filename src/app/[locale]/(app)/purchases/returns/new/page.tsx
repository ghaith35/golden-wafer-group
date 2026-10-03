import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { SupplierReturnForm } from "../ReturnForm";
import { BackButton } from "@/components/ui/BackButton";

export default async function NewSupplierReturnPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("purchases");
  const tc = await getTranslations("common");
  const [suppliers, products] = await Promise.all([
    prisma.supplier.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({
      where: { companyId: session.companyId, isActive: true },
      orderBy: { name: "asc" },
      take: 500,
      include: { baseUnit: true, conversions: { include: { unit: true } } },
    }),
  ]);
  return (
    <div className="space-y-4 p-5 md:p-6">
      <BackButton fallback={`/${locale}/purchases/returns`} />
      <SupplierReturnForm
      locale={locale}
      suppliers={suppliers}
      products={JSON.parse(JSON.stringify(products)).map(
        (p: {
          id: string;
          name: string;
          stockQty: unknown;
          colisage: string | null;
          baseUnitId: string | null;
          baseUnit: { id: string; name: string } | null;
          conversions: Array<{ unitId: string; factor: number; unit: { id: string; name: string } }>;
        }) => ({
          id: p.id,
          name: p.name,
          stockQty: Number(p.stockQty),
          colisage: p.colisage ?? null,
          baseUnitId: p.baseUnitId,
          baseUnit: p.baseUnit,
          conversions: (p.conversions ?? []).map((c) => ({
            unitId: c.unitId,
            factor: Number(c.factor),
            unit: c.unit,
          })),
        })
      )}
      labels={{
        supplier: t("supplier"), product: t("product"), qty: t("qty"), price: t("price"),
        addLine: t("addLine"), notes: tc("notes"), total: tc("total"), save: tc("save"),
      }}
    />
    </div>
  );
}
