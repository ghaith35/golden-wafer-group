import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { ProductForm, type ProductData } from "../ProductForm";
import { BackButton } from "@/components/ui/BackButton";

export default async function EditProductPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("products");
  const tc = await getTranslations("common");
  const [product, categories, suppliers, units, tiers] = await Promise.all([
    prisma.product.findFirst({
      where: { id, companyId: session.companyId },
      include: { images: { orderBy: { sortOrder: "asc" } }, conversions: true, tierPrices: true },
    }),
    prisma.productCategory.findMany({ where: { companyId: session.companyId }, orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ where: { companyId: session.companyId }, orderBy: { name: "asc" } }),
    prisma.unit.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.priceTier.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  if (!product) notFound();
  const initial: ProductData = {
    id: product.id,
    name: product.name,
    reference: product.reference,
    barcode: product.barcode,
    colisage: product.colisage,
    categoryId: product.categoryId,
    supplierId: product.supplierId,
    baseUnitId: product.baseUnitId,
    minStock: Number(product.minStock),
    salePrice: Number(product.salePrice),
    costPrice: Number(product.costPrice),
    images: product.images.map((i) => i.url),
    conversions: product.conversions.map((c) => ({ unitId: c.unitId, factor: Number(c.factor) })),
    tierPrices: product.tierPrices.map((x) => ({ tierId: x.tierId, price: Number(x.price) })),
  };
  return (
    <div className="space-y-4 p-5 md:p-6">
      <BackButton fallback={`/${locale}/products`} />
      <ProductForm
      locale={locale}
      initial={initial}
      categories={categories}
      suppliers={JSON.parse(JSON.stringify(suppliers))}
      units={units}
      tiers={tiers}
      labels={{
        name: t("name"), reference: t("reference"), barcode: t("barcode"), colisage: t("colisage"),
        category: t("category"), noCategory: t("noCategory"), supplier: t("supplier"), baseUnit: t("baseUnit"),
        salePrice: t("salePrice"), costPrice: t("costPrice"), minStock: t("minStock"),
        images: t("images"), addImages: t("addImages"), conversions: t("conversions"),
        factorHint: t("factorHint"), tierPrices: t("tierPrices"), save: tc("save"), cancel: tc("cancel"),
      }}
    />
    </div>
  );
}
