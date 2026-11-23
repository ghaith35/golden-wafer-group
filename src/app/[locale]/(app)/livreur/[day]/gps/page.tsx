import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getLivreurVan } from "../../_data";
import { parseDay } from "../../_days";
import { dayBounds } from "@/lib/livreur/day-access";
import { GpsClient } from "./GpsClient";

/// مواقع GPS — every client with a position, on a phone-first map, colour
/// coded by distance from the driver. All data is server-rendered into the
/// page (cached for offline by the journée warm-up) — no live query needed.
export default async function LivreurGpsPage({
  params,
}: {
  params: Promise<{ locale: string; day: string }>;
}) {
  const { locale, day } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const date = parseDay(day);
  if (!date) redirect(`/${locale}/livreur`);
  const van = await getLivreurVan(session.companyId, session.userId);
  if (!van) redirect(`/${locale}/livreur`);
  const t = await getTranslations("livreur");
  const tg = await getTranslations("tournees");

  const { start, end } = dayBounds(date);
  const [closedRows, tour, rows] = await Promise.all([
    prisma.closedVisit.findMany({
      where: { companyId: session.companyId, locationId: van.id, occurredAt: { gte: start, lte: end } },
      select: { customerId: true },
    }),
    prisma.tournee.findFirst({
      where: { companyId: session.companyId, locationId: van.id, date: { gte: start, lte: end } },
      select: { secteurId: true, startedAt: true, stops: { select: { clientId: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.customer.findMany({
      where: { companyId: session.companyId, isActive: true, gpsLat: { not: null }, gpsLng: { not: null } },
      select: {
        id: true, code: true, name: true, phone: true, gpsLat: true, gpsLng: true,
        secteurId: true, secteur: { select: { name: true } },
      },
      orderBy: { name: "asc" },
      take: 2500,
    }),
  ]);

  const clients = rows.map((c) => ({
    id: c.id, code: c.code, name: c.name, phone: c.phone,
    lat: Number(c.gpsLat), lng: Number(c.gpsLng),
    secteurId: c.secteurId, secteurName: c.secteur?.name ?? null,
  }));

  return (
    <GpsClient
      locale={locale}
      day={day}
      hasStarted={!!tour?.startedAt}
      closedToday={[...new Set(closedRows.map((c) => c.customerId))]}
      todayIds={(tour?.stops ?? []).map((s) => s.clientId)}
      todaySecteurId={tour?.secteurId ?? null}
      clients={clients}
      labels={{
        title: t("gpsTitle"), all: t("clients"), today: t("gpsToday"), todaySector: t("gpsTodaySector"),
        near: t("proxNear"), mid: t("proxMid"), far: t("proxFar"), none: t("proxNone"),
        noPos: t("gpsNoPos"), refresh: t("gpsRefresh"), call: t("callClient"), locating: t("gpsLocating"),
        empty: t("gpsEmpty"), unitM: tg("unitM"), unitKm: tg("unitKm"),
        closedShop: t("closedShop"), closedAddPhoto: t("closedAddPhoto"), closedSave: t("closedSave"), closedHint: t("closedHint"),
        closedBadge: t("closedBadge"), closedErr: t("closedErr"), closedSaved: t("closedSaved"), closedSavedOffline: t("closedSavedOffline"),
      }}
    />
  );
}
