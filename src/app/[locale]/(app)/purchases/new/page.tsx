import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { PurchaseForm } from "../PurchaseForm";
import { BackButton } from "@/components/ui/BackButton";
import { getPurchaseFormData } from "../purchaseRefs";

export default async function NewPurchasePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("purchases");
  const tc = await getTranslations("common");
  const tp = await getTranslations("products");
  const ti = await getTranslations("inventory");
  const ts = await getTranslations("suppliers");
  const d = await getPurchaseFormData(session.companyId);
  const productLabels = {
    name: tp("name"), reference: tp("reference"), barcode: tp("barcode"), colisage: tp("colisage"),
    category: tp("category"), noCategory: tp("noCategory"), supplier: tp("supplier"), baseUnit: tp("baseUnit"),
    salePrice: tp("salePrice"), costPrice: tp("costPrice"), minStock: tp("minStock"),
    images: tp("images"), addImages: tp("addImages"), conversions: tp("conversions"),
    factorHint: tp("factorHint"), tierPrices: tp("tierPrices"), save: tc("save"), cancel: tc("cancel"),
    saleUnit: tp("saleUnit"), purchaseUnit: tp("purchaseUnit"),
    pieceUnit: tp("pieceUnit"), piecesPerPack: tp("piecesPerPack"),
    colisageTitle: tp("colisageTitle"), smallestUnit: tp("smallestUnit"),
    kindUnite: tp("kindUnite"), kindColis: tp("kindColis"), kindDouble: tp("kindDouble"),
    colisName: tp("colisName"), colisContains: tp("colisContains"), colisNamePh: tp("colisNamePh"),
    qtyPer: tp("qtyPer"), surColisName: tp("surColisName"), surColisNamePh: tp("surColisNamePh"),
    qtyPerL1: tp("qtyPerL1"), legacyPieces: tp("legacyPieces"), colisageAuto: tp("colisageAuto"),
    colisL1Required: tp("colisL1Required"), colisL2Required: tp("colisL2Required"),
    newCategory: tp("newCategory"), newCategoryPh: tp("newCategoryPh"),
    unitName: tp("unitName"), unitNamePh: tp("unitNamePh"), unitRequired: tp("unitRequired"),
    newSupplier: tp("newSupplier"), newSupplierPh: tp("newSupplierPh"),
    newProduct: tp("new"),
  };
  return (
    <div className="w-full space-y-4 p-5 md:p-6">
      <BackButton fallback={`/${locale}/purchases`} />
      <PurchaseForm
        locale={locale}
        suppliers={d.suppliers}
        products={d.products}
        units={d.units}
        tiers={d.tiers}
        locations={d.locations}
        remiseEnabled={d.settings.remiseEnabled}
        expiryEnabled={d.settings.expiryEnabled}
        multiDepot={d.settings.multiDepotEnabled}
        supplierFilter={d.settings.supplierFilterEnabled ?? true}
        categories={d.categories}
        productLabels={productLabels}
        labels={{
          supplier: t("supplier"), newSupplier: t("newSupplier"), date: tc("date"), product: t("product"),
          unit: t("unit"), qty: t("qty"), free: t("free"), price: t("price"), remise: t("remise"),
          expiry: t("expiry"), addLine: t("addLine"), notes: tc("notes"), total: tc("total"), save: tc("save"),
          cancel: tc("cancel"), stock: tp("stock"), locations: ti("locations"),
          barcode: tp("barcode"), salePrice: tp("salePrice"),
          paid: t("paid"), remaining: t("remaining"), overpayment: t("overpayment"),
        bulkAdd: t("bulkAdd"), selectAll: t("selectAll"), addSelected: t("addSelected"),
          currency: d.settings.currency === "DZD" ? "DA" : d.settings.currency,
          phone: ts("phone"),
        factoryInvoice: t("factoryInvoice"), attachFactoryInvoice: t("attachFactoryInvoice"),
        changeImage: t("changeImage"), removeImage: t("removeImage"), imageFailed: t("imageFailed"), optional: t("optional"),
        }}
      />
    </div>
  );
}
