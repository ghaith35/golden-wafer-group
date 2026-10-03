import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { TransferForm } from "../TransferForm";
import { BackButton } from "@/components/ui/BackButton";

export default async function NewTransferPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("inventory");
  const tc = await getTranslations("common");
  const tp = await getTranslations("purchases");
  const [locations, products] = await Promise.all([
    prisma.store.findMany({
      where: { companyId: session.companyId, isActive: true },
      include: { user: { select: { fullName: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({
      where: { companyId: session.companyId, isActive: true },
      include: { baseUnit: true, conversions: { include: { unit: true } }, images: { orderBy: { sortOrder: "asc" }, take: 1 } },
      orderBy: { name: "asc" },
      take: 500,
    }),
  ]);
  // Guided flows: /transfers/new?to=<vanId> (load) or ?from=<vanId> (return).
  // Default the other side to the main depot.
  const mainDepot = locations.find((l) => l.kind === "DEPOT")?.id ?? "";
  const presetTo = sp.to ?? "";
  const presetFrom = sp.from ?? "";
  return (
    <div className="space-y-4">
      <div className="px-5 pt-5 md:px-6 md:pt-6">
        <BackButton fallback={`/${locale}/inventory/transfers`} />
      </div>
      <TransferForm
      locale={locale}
      locations={locations}
      products={JSON.parse(JSON.stringify(products)).map((p: { stockQty: unknown } & Record<string, unknown>) => ({ ...p, stockQty: Number(p.stockQty) }))}
      presetFrom={presetFrom || (presetTo ? mainDepot : "")}
      presetTo={presetTo || (presetFrom ? mainDepot : "")}
      labels={{
        from: t("from"), to: t("to"), cashAmount: t("cashAmount"), notes: tc("notes"),
        product: tp("product"), unit: tp("unit"), addLine: tp("addLine"), save: tc("save"),
        stepRoute: t("stepRoute"), stepLines: t("stepLines"), stepReview: t("stepReview"),
        next: t("next"), back: t("back"), queued: t("queued"), search: tc("search"),
        sourceStock: t("sourceStock"), emptySource: t("emptySource"), onlyAvailable: t("onlyAvailable"),
        loadingStock: t("loadingStock"), emptyLocation: t("emptyLocation"), addAll: t("addAll"),
      }}
    />
    </div>
  );
}
