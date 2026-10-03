import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getLivreurVan } from "../../_data";
import { parseDay } from "../../_days";
import { FacturesClient } from "./FacturesClient";

/// Step 5 — Factures: van tickets, view + cancel.
export default async function LivreurFacturesPage({
  params,
}: {
  params: Promise<{ locale: string; day: string }>;
}) {
  const { locale, day } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  if (!parseDay(day)) redirect(`/${locale}/livreur`);
  const t = await getTranslations("livreur");
  const van = await getLivreurVan(session.companyId, session.userId);
  if (!van) redirect(`/${locale}/livreur`);

  const rows = await prisma.sale.findMany({
    where: { companyId: session.companyId, locationId: van.id, kind: "TICKET" },
    include: { client: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <FacturesClient
      locale={locale}
      day={day}
      rows={JSON.parse(JSON.stringify(rows))}
      labels={{
        factures: t("factures"), empty: t("empty"), viewSale: t("viewSale"),
        deleteSale: t("deleteSale"), confirmDelete: t("confirmDelete"),
        yes: t("yes"), no: t("no"),
      }}
    />
  );
}
