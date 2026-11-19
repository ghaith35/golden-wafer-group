import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { KpiCard } from "@/components/ui/Card";
import { dzMoney } from "@/lib/format";
import { BarChart3, ReceiptText, TrendingUp, Wallet } from "lucide-react";
import { PurchasesClient } from "./PurchasesClient";
import { getPurchaseFormData } from "./purchaseRefs";

const fmt = (v: number) => dzMoney(v);

export default async function PurchasesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("purchases");
  const tc = await getTranslations("common");
  const tp = await getTranslations("products");
  const ti = await getTranslations("inventory");
  const ts = await getTranslations("suppliers");
  const th = await getTranslations("cash");
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [rows, formData, monthAgg, allAgg] = await Promise.all([
    prisma.purchaseInvoice.findMany({
      where: { companyId: session.companyId },
      include: { supplier: true, _count: { select: { lines: true } } },
      orderBy: { date: "desc" },
      take: 200,
    }),
    getPurchaseFormData(session.companyId),
    prisma.purchaseInvoice.aggregate({
      where: { companyId: session.companyId, date: { gte: monthStart } },
      _sum: { total: true },
      _count: true,
    }),
    prisma.purchaseInvoice.aggregate({
      where: { companyId: session.companyId },
      _sum: { total: true, paid: true },
      _count: true,
    }),
  ]);
  const monthTotal = Number(monthAgg._sum.total ?? 0);
  const monthCount = monthAgg._count;
  const grandTotal = Number(allAgg._sum.total ?? 0);
  const grandPaid = Number(allAgg._sum.paid ?? 0);
  const remaining = grandTotal - grandPaid;
  const avg = allAgg._count > 0 ? grandTotal / allAgg._count : 0;
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
    <div className="flex flex-col space-y-4 p-5 md:p-6 lg:h-[calc(var(--vh)-3.5rem)] lg:overflow-hidden lg:pb-4">
      <div className="grid shrink-0 grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiCard
          label={t("kpiMonth")}
          value={fmt(monthTotal)}
          icon={<TrendingUp size={18} />}
          accent="bg-sky-500/15 text-sky-600"
          compact
        />
        <KpiCard
          label={t("kpiCount")}
          value={String(monthCount)}
          icon={<ReceiptText size={18} />}
          accent="bg-violet-500/15 text-violet-500"
          compact
        />
        <KpiCard
          label={t("kpiRemaining")}
          value={fmt(remaining)}
          icon={<Wallet size={18} />}
          accent="bg-red-500/15 text-red-500"
          compact
        />
        <KpiCard
          label={t("kpiAvg")}
          value={fmt(avg)}
          icon={<BarChart3 size={18} />}
          accent="bg-emerald-500/15 text-emerald-600"
          compact
        />
      </div>
      <PurchasesClient
      locale={locale}
      rows={JSON.parse(JSON.stringify(rows))}
      formData={formData}
      productLabels={productLabels}
      formLabels={{
        supplier: t("supplier"), newSupplier: t("newSupplier"), date: tc("date"), product: t("product"),
        unit: t("unit"), qty: t("qty"), free: t("free"), price: t("price"), remise: t("remise"),
        expiry: t("expiry"), addLine: t("addLine"), notes: tc("notes"), total: tc("total"), save: tc("save"),
        cancel: tc("cancel"), stock: tp("stock"), locations: ti("locations"),
        barcode: tp("barcode"), salePrice: tp("salePrice"),
        paid: t("paid"), remaining: t("remaining"), overpayment: t("overpayment"),
        bulkAdd: t("bulkAdd"), selectAll: t("selectAll"), addSelected: t("addSelected"),
        currency: formData.settings.currency === "DZD" ? "DA" : formData.settings.currency,
        phone: ts("phone"),
      }}
      labels={{
        title: t("title"), returns: t("returns"), neW: t("new"), empty: t("empty"),
        number: t("number"), total: tc("total"), search: tc("search"),
        details: tc("details"), edit: tc("edit"), delete: tc("delete"),
        deleteTitle: tc("deleteTitle"), deleteMessage: tc("deleteMessage"),
        paid: t("paid"), remaining: t("remaining"), remise: t("remise"),
        unpaid: t("unpaid"), partial: t("partial"), settled: t("settled"),
      }}
      payLabels={{
        payments: t("payments"), addPayment: t("addPayment"), payAll: t("payAll"),
        total: tc("total"), paid: t("paid"), remaining: t("remaining"),
        empty: t("empty"), amount: th("amount"), save: tc("save"), delete: tc("delete"),
        deleteTitle: tc("deleteTitle"), deleteMessage: tc("deleteMessage"),
      }}
      />
    </div>
  );
}
