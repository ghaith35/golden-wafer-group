import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getLivreurVan } from "../../../_data";
import { parseDay } from "../../../_days";
import { pickCurrentTour } from "@/lib/tournees/day-tours";
import { NewClient } from "./NewClient";
import { loadAreaScope } from "@/lib/users/area-scope.server";

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

  const areaScope = await loadAreaScope(session.userId, session.role);
  // Sector of that day's tour (the one being driven, else the next waiting).
  const dayDate = parseDay(day)!;
  const dStart = new Date(dayDate);
  dStart.setHours(0, 0, 0, 0);
  const dEnd = new Date(dayDate);
  dEnd.setHours(23, 59, 59, 999);
  const dayTours = await prisma.tournee.findMany({
    where: { companyId: session.companyId, locationId: van.id, date: { gte: dStart, lte: dEnd } },
    select: { secteurId: true, startedAt: true, finishedAt: true, status: true, slot: true, createdAt: true },
  });
  const defaultSecteurId = pickCurrentTour(dayTours)?.secteurId ?? null;

  return (
    <NewClient
      locale={locale}
      day={day}
      companyId={session.companyId}
      wilayas={JSON.parse(JSON.stringify(wilayas))}
      secteurs={JSON.parse(JSON.stringify(secteurs))}
      tiers={JSON.parse(JSON.stringify(tiers))}
      areaScope={areaScope}
      defaultSecteurId={defaultSecteurId}
      labels={{
        newClient: t("newClient"), clientName: t("clientName"), phoneOpt: t("phoneOpt"), addressOpt: t("addressOpt"),
        activityOpt: t("activityOpt"), wilayaOpt: t("wilayaOpt"), secteurOpt: t("secteurOpt"),
        tierOpt: t("tierOpt"), useGps: t("useGps"), confirm: t("confirm"),
        cancel: t("cancel"), empty: t("empty"), clients: t("clients"),
        qrReady: t("qrReady"), pendingSync: t("pendingSync"), another: t("another"),
        saveQr: t("saveQr"), qrSaved: t("qrSaved"), qrShared: t("qrShared"), qrSaveFail: t("qrSaveFail"),
        secteurOffline: t("secteurOffline"),
        errOutsideArea: t("errOutsideArea"), errAreaRequired: t("errAreaRequired"),
      }}
    />
  );
}
