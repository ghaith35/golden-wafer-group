import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { TransfersJournal } from "./TransfersJournal";

export default async function TransfersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("inventory");
  const tc = await getTranslations("common");
  const [rows, locations] = await Promise.all([
    prisma.transfer.findMany({
      where: { companyId: session.companyId },
      include: {
        fromLocation: true,
        toLocation: true,
        lines: { include: { product: { include: { images: { orderBy: { sortOrder: "asc" }, take: 1 } } } } },
      },
      orderBy: { date: "desc" },
      take: 200,
    }),
    prisma.store.findMany({ where: { companyId: session.companyId, isActive: true, NOT: { kind: "VAN", user: { role: "Vendeur" } }, }, orderBy: { name: "asc" } }),
  ]);
  return (
    <TransfersJournal
      locale={locale}
      initial={JSON.parse(JSON.stringify(rows))}
      locations={JSON.parse(JSON.stringify(locations))}
      labels={{
        title: t("transfers"),
        neW: t("newTransfer"),
        empty: t("empty"),
        search: tc("search"),
        from: t("from"),
        to: t("to"),
        status: t("status"),
        statusAll: t("statusAll"),
        fToday: t("fToday"),
        fWeek: t("fWeek"),
        fMonth: t("fMonth"),
        fCustom: t("fCustom"),
        dateFrom: t("dateFrom"),
        dateTo: t("dateTo"),
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
