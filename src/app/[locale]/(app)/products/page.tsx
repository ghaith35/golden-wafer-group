import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { ProductsClient } from "./ProductsClient";

export default async function ProductsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("products");
  const tc = await getTranslations("common");
  const [products, categories, suppliers, units, tiers, batches] = await Promise.all([
    prisma.product.findMany({
      where: { companyId: session.companyId },
      include: {
        images: { orderBy: { sortOrder: "asc" }, take: 3 },
        category: true,
        baseUnit: true,
        conversions: { include: { unit: true } },
        tierPrices: { include: { tier: true } },
        qtyTiers: true,
      },
      orderBy: { name: "asc" },
      take: 300,
    }),
    prisma.productCategory.findMany({ where: { companyId: session.companyId }, orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ where: { companyId: session.companyId }, orderBy: { name: "asc" } }),
    prisma.unit.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.priceTier.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.stockBatch.findMany({
      where: { companyId: session.companyId, transferId: null, qty: { gt: 0 } },
      select: { productId: true, qty: true, unitCost: true, storeId: true, location: { select: { kind: true } } },
    }),
  ]);
  const stockById: Record<string, { qty: number; cump: number; value: number }> = {};
  /// Depot-only stock per product: transfers move units to vans, so the
  /// global card total no longer answers "what is left in the depot?".
  /// (Null store = legacy main stock → counts as depot.)
  const depotById: Record<string, number> = {};
  const vanById: Record<string, number> = {};
  for (const b of batches) {
    const e = (stockById[b.productId] ??= { qty: 0, cump: 0, value: 0 });
    const q = Number(b.qty);
    e.qty += q;
    e.value += q * Number(b.unitCost);
    const kind = (b.location as { kind: string } | null)?.kind;
    if (b.storeId == null || kind === "DEPOT") {
      depotById[b.productId] = (depotById[b.productId] ?? 0) + q;
    } else if (kind === "VAN") {
      vanById[b.productId] = (vanById[b.productId] ?? 0) + q;
    }
  }
  for (const e of Object.values(stockById)) {
    e.cump = e.qty > 0 ? e.value / e.qty : 0;
  }
  return (
    <ProductsClient
      locale={locale}
      initial={JSON.parse(JSON.stringify(products))}
      stockById={stockById}
      depotById={depotById}
      vanById={vanById}
      categories={categories}
      suppliers={JSON.parse(JSON.stringify(suppliers))}
      units={units}
      tiers={tiers}
      labels={{
        title: t("title"), neW: t("new"), search: tc("search"), stock: t("stock"),
        alerts: t("alerts"),
        cump: t("cump"), stockValue: t("stockValue"), margin: t("margin"),
        depot: t("depot"), trucks: t("trucks"),
        noCategory: t("noCategory"), details: tc("details"), edit: tc("edit"), delete: tc("delete"),
        deleteTitle: tc("deleteTitle"), deleteMessage: tc("deleteMessage"),
        name: t("name"), reference: t("reference"), barcode: t("barcode"), colisage: t("colisage"),
        category: t("category"), supplier: t("supplier"), baseUnit: t("baseUnit"),
        salePrice: t("salePrice"), costPrice: t("costPrice"), minStock: t("minStock"),
        images: t("images"), addImages: t("addImages"), conversions: t("conversions"),
        factorHint: t("factorHint"), tierPrices: t("tierPrices"), save: tc("save"), cancel: tc("cancel"),
        saleUnit: t("saleUnit"), purchaseUnit: t("purchaseUnit"),
        pieceUnit: t("pieceUnit"), piecesPerPack: t("piecesPerPack"),
        newCategory: t("newCategory"), newCategoryPh: t("newCategoryPh"),
        unitName: t("unitName"), unitNamePh: t("unitNamePh"), unitRequired: t("unitRequired"),
        newSupplier: t("newSupplier"), newSupplierPh: t("newSupplierPh"),
        colisageTitle: t("colisageTitle"), smallestUnit: t("smallestUnit"),
        kindUnite: t("kindUnite"), kindColis: t("kindColis"), kindDouble: t("kindDouble"),
        colisName: t("colisName"), colisContains: t("colisContains"), colisNamePh: t("colisNamePh"),
        qtyPer: t("qtyPer"), surColisName: t("surColisName"), surColisNamePh: t("surColisNamePh"),
        qtyPerL1: t("qtyPerL1"), legacyPieces: t("legacyPieces"), colisageAuto: t("colisageAuto"),
        colisL1Required: t("colisL1Required"), colisL2Required: t("colisL2Required"),
        import: t("import"), importTitle: t("importTitle"), importHint: t("importHint"),
        importFile: t("importFile"), importStart: t("importStart"), importing: t("importing"),
        importDone: t("importDone"), importSkipped: t("importSkipped"),
        importStock: t("importStock"), importInactive: t("importInactive"),
        importBadFile: t("importBadFile"), importFailed: t("importFailed"),
      }}
    />
  );
}
