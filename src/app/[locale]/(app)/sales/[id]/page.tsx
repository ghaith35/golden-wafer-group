import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { SaleActions } from "./SaleActions";
import { BackButton } from "@/components/ui/BackButton";

export default async function SaleDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("sales");
  const [sale, locations] = await Promise.all([
    prisma.sale.findFirst({
      where: { id, companyId: session.companyId },
      include: {
        // Full product graph like /api/sales/[id]: the line table needs
        // conversions + baseUnit (pack prices/qtys), not just product: true.
        lines: {
          include: {
            product: {
              include: {
                images: { orderBy: { sortOrder: "asc" } },
                conversions: { include: { unit: true } },
                baseUnit: true,
              },
            },
          },
        },
        client: true,
        location: true,
        children: true,
      },
    }),
    prisma.store.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: { name: "asc" } }),
  ]);
  if (!sale) notFound();

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-5 md:p-6 lg:max-w-4xl xl:max-w-5xl">
      <BackButton fallback={`/${locale}/commandes`} />
      <SaleActions
        locale={locale}
        sale={JSON.parse(JSON.stringify(sale))}
        locations={locations}
        labels={{
          client: t("client"), walkin: t("walkin"), total: t("total"), paid: t("paid"), due: t("due"),
          confirm: t("confirm"), deliver: t("deliver"), invoice: t("invoice"), cancel: t("cancel"),
          print: t("print"), location: t("location"), move: t("move"), moveTo: t("moveTo"),
          unitPriceL: t("unitPriceL"), packPriceL: t("packPriceL"), product: t("product"),
          qtyPack: t("qtyPack"), qtyPiece: t("qtyPiece"), assign: t("assign"),
          confirmOrderT: t("confirmOrderT"), confirmOrderM: t("confirmOrderM"),
          invoiceT: t("invoiceT"), invoiceM: t("invoiceM"), cancelT: t("cancelT"), cancelM: t("cancelM"),
          redeliverT: t("redeliverT"), redeliverM: t("redeliverM"),
          assignT: t("assignT"), deliverT: t("deliverT"), van: t("van"),
          confirmLoad: t("confirmLoad"), confirmLoadT: t("confirmLoadT"), confirmLoadM: t("confirmLoadM"),
          siteCheck: t("siteCheck"), siteSale: t("siteSale"), siteClient: t("siteClient"), awayFromClient: t("awayFromClient"),
        }}
      />
    </div>
  );
}
