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

  const rows = await prisma.transfer.findMany({
    where: { companyId: session.companyId, toLocation: { kind: "VAN" } },
    include: {
      fromLocation: { select: { name: true } },
      toLocation: { select: { name: true } },
      lines: { include: { product: { select: { id: true, name: true, baseUnit: { select: { name: true } }, conversions: { select: { unitId: true, factor: true, unit: { select: { name: true } } } } } } } },
    },
    orderBy: { date: "desc" },
    take: 100,
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
