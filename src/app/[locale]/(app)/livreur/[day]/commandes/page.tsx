import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getLivreurVan } from "../../_data";
import { parseDay } from "../../_days";
import { VanOrdersClient } from "./VanOrdersClient";

/// Livreur commandes: DRAFT + CONFIRMED orders assigned to his van.
/// ?ready=1 → only CONFIRMED (packed, assigned — the "جاهز للتوصيل" section).
export default async function LivreurOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; day: string }>;
  searchParams: Promise<{ ready?: string }>;
}) {
  const { locale, day } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  if (!parseDay(day)) redirect(`/${locale}/livreur`);
  const t = await getTranslations("livreur");
  const van = await getLivreurVan(session.companyId, session.userId);
  if (!van) redirect(`/${locale}/livreur`);

  const readyOnly = sp.ready === "1";
  const rows = await prisma.sale.findMany({
    where: {
      companyId: session.companyId,
      kind: "ORDER",
      status: readyOnly ? "CONFIRMED" : { in: ["DRAFT", "CONFIRMED"] },
      locationId: van.id,
    },
    include: {
      client: { select: { name: true, code: true } },
      _count: { select: { lines: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <VanOrdersClient
      locale={locale}
      day={day}
      rows={JSON.parse(JSON.stringify(rows))}
      labels={{
        title: readyOnly ? t("ready") : t("commandes"),
        commandes: t("commandes"), empty: t("empty"), total: t("total"),
      }}
    />
  );
}
