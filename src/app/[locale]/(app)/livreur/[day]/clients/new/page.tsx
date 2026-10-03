import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getLivreurVan } from "../../../_data";
import { parseDay } from "../../../_days";
import { NewClient } from "./NewClient";

/// Livreur adds a client (online → API, offline → outbox sync).
/// Same fields as the admin form: identity + wilaya/secteur/tier + GPS.
export default async function LivreurNewClientPage({
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

  const [wilayas, secteurs, tiers] = await Promise.all([
    prisma.wilaya.findMany({ orderBy: { code: "asc" } }),
    prisma.secteur.findMany({
      where: { companyId: session.companyId, isActive: true },
      orderBy: { name: "asc" },
    }),
    prisma.priceTier.findMany({
      where: { companyId: session.companyId, isActive: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  return (
    <NewClient
      locale={locale}
      day={day}
      companyId={session.companyId}
      wilayas={JSON.parse(JSON.stringify(wilayas))}
      secteurs={JSON.parse(JSON.stringify(secteurs))}
      tiers={JSON.parse(JSON.stringify(tiers))}
      labels={{
        newClient: t("newClient"), phoneOpt: t("phoneOpt"), addressOpt: t("addressOpt"),
        activityOpt: t("activityOpt"), wilayaOpt: t("wilayaOpt"), secteurOpt: t("secteurOpt"),
        tierOpt: t("tierOpt"), useGps: t("useGps"), confirm: t("confirm"),
        cancel: t("cancel"), empty: t("empty"), clients: t("clients"),
        qrReady: t("qrReady"), pendingSync: t("pendingSync"), another: t("another"),
        saveQr: t("saveQr"),
      }}
    />
  );
}
