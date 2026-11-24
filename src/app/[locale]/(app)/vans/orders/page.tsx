import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { VanRequestsClient } from "./VanRequestsClient";

/// Admin "طلبات الشاحنات": inbound van restock requests (depot→van,
/// DECLARED). Validating confirms the transfer immediately — stock moves
/// depot→van in one step, no van-side confirmation. Staff never reach here
/// (proxy blocks /vans/*); the PATCH endpoint enforces Admin anyway.
export default async function VansOrdersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("inventory");
  const tc = await getTranslations("common");
  const tv = await getTranslations("vanRequests");

  const rows = await prisma.transfer.findMany({
    where: { companyId: session.companyId, toLocation: { kind: "VAN" } },
    include: {
      fromLocation: { select: { name: true } },
      toLocation: { select: { name: true, matricule: true, user: { select: { fullName: true } } } },
      lines: {
        include: {
          product: {
            select: {
              id: true, name: true,
              images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
              baseUnit: { select: { name: true } },
              conversions: { select: { unitId: true, factor: true, unit: { select: { name: true } } } },
            },
          },
        },
      },
    },
    orderBy: { date: "desc" },
    take: 300,
  });

  return (
    <VanRequestsClient
      locale={locale}
      rows={JSON.parse(JSON.stringify(rows))}
      labels={{
        title: t("vanOrders"), empty: t("empty"),
        validate: t("validate"), reject: t("reject"),
        cancel: tc("cancel"), statusAll: t("statusAll"),
        from: t("from"), to: t("to"), date: tc("date"),
        kpiPending: tv("kpiPending"), kpiColisPending: tv("kpiColisPending"), kpiToday: tv("kpiToday"), kpiRejected: tv("kpiRejected"),
        search: tv("search"), allVans: tv("allVans"), rangeAll: tv("rangeAll"), rangeToday: tv("rangeToday"), range7: tv("range7"), range30: tv("range30"),
        sortNew: tv("sortNew"), sortOld: tv("sortOld"), products: tv("products"), colis: tv("colis"), pieces: tv("pieces"),
        view: tv("view"), print: tv("print"), openFull: tv("openFull"), requested: tv("requested"), approved: tv("approved"),
        driver: tv("driver"), waiting: tv("waiting"), ago: tv("ago"), justNow: tv("justNow"), failed: tv("failed"), close: tv("close"),
      }}
      statusLabel={{
        DECLARED: t("declared"),
        CONFIRMED: t("confirmed"),
        REJECTED: t("rejected"),
        CANCELLED: t("cancelled"),
      }}
    />
  );
}
