import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getLivreurVan } from "../_data";
import { parseDay } from "../_days";
import { todayJourneeTour } from "@/lib/tournees/journee-today";
import { closedClientIdsToday } from "@/lib/closed-visits/service";
import { DayClients } from "./DayClients";
import { ensureDayTours } from "@/lib/tournees/plans";
import { pickCurrentTour, sortDayTours } from "@/lib/tournees/day-tours";
import { algiersDayKey } from "@/lib/tournees/days";
import { loadAreaScope } from "@/lib/users/area-scope.server";

/// Step 2 — Clients of THIS day only: the day's tour stops and its sector.
/// Nothing from other days; no tour planned = empty list ("no tournée").
export default async function LivreurDayPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; day: string }>;
  searchParams: Promise<{ tour?: string }>;
}) {
  const { locale, day } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const date = parseDay(day);
  if (!date) redirect(`/${locale}/livreur`);
  const t = await getTranslations("livreur");
  const tg = await getTranslations("tournees");
  const tv = await getTranslations("clientView");
  const van = await getLivreurVan(session.companyId, session.userId);
  if (!van) redirect(`/${locale}/livreur`);

  const sel = { id: true, name: true, code: true, legacyQr: true, phone: true, tierId: true, balance: true, gpsLat: true, gpsLng: true, secteurId: true };
  // Only THIS day's tour: its sector and its planned clients. Other days'
  // stops (and "every client" fallbacks) are never loaded.
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);
  // Recurring plans generate this day's tours on demand (one or two per van).
  await ensureDayTours(session.companyId, van.id, algiersDayKey(dayStart));
  const dayTours = sortDayTours(
    await prisma.tournee.findMany({
      where: { companyId: session.companyId, locationId: van.id, date: { gte: dayStart, lte: dayEnd } },
      include: {
        secteur: { select: { name: true } },
        stops: {
          include: { client: { select: sel } },
          orderBy: { position: "asc" },
        },
      },
    }),
  );
  // ?tour=<id> picks one; else the tour being driven (or the next waiting).
  const tour = dayTours.find((x) => x.id === sp.tour) ?? pickCurrentTour(dayTours);
  // Départ is always today's journée — not the picked day's tour.
  const jTour = await todayJourneeTour(session.companyId, van.id);
  const closedToday = await closedClientIdsToday(session.companyId, van.id).catch(() => [] as string[]);
  const planned = (tour?.stops ?? []).filter((s) => s.client).map((s) => s.client as unknown as { id: string });
  // Clients registered THIS day (new-client popup) are not tour stops, yet the
  // driver must see them right after saving — only the ones HE registered, never
  // another driver's or the office's.
  const plannedIds = new Set(planned.map((c) => c.id));
  const createdToday = await prisma.customer.findMany({
    where: { companyId: session.companyId, isActive: true, createdById: session.userId, createdAt: { gte: dayStart, lte: dayEnd }, id: { notIn: [...plannedIds] } },
    select: sel,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const clients = [...planned, ...createdToday].map((c) => ({ ...(c as unknown as Record<string, unknown>), days: [day] }));
  const daySlugs: string[] = [];

  // Reference lists for the embedded new-client popup (same as /clients/new).
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

  return (
    <DayClients
      locale={locale}
      day={day}
      vanName={van.name}
      hasTournee={!!tour}
      hasStarted={!!jTour?.startedAt && !jTour?.finishedAt}
      closedToday={closedToday}
      tours={dayTours.map((x) => ({ id: x.id, secteurName: x.secteur?.name ?? null, stopsCount: x.stops.length, running: !!x.startedAt && !x.finishedAt, done: !!x.finishedAt }))}
      tourId={tour?.id ?? null}
      tourSecteurId={tour?.secteurId ?? null}
      days={daySlugs}
      sectorName={tour?.secteur?.name ?? null}
      clients={JSON.parse(JSON.stringify(clients))}
      companyId={session.companyId}
      refs={JSON.parse(JSON.stringify({ wilayas, secteurs, tiers }))}
      role={session.role}
      areaScope={areaScope}
      labels={{
        clients: t("clients"), searchClient: t("searchClient"), empty: t("empty"),
        online: t("online"), offline: t("offline"),
        noTournee: t("noTournee"), skip: t("skip"), actualiser: t("actualiser"),
        closedShop: t("closedShop"), closedAddPhoto: t("closedAddPhoto"), closedSave: t("closedSave"), closedHint: t("closedHint"),
        closedBadge: t("closedBadge"), closedErr: t("closedErr"), closedShoot: t("closedShoot"), closedCancel: t("closedCancel"), closedSaved: t("closedSaved"), closedSavedOffline: t("closedSavedOffline"),
        closedNeedStart: t("closedNeedStart"), closedToday: t("closedToday"),
        locate: tg("locate"), geoDenied: tg("geoDenied"),
        unitM: tg("unitM"), unitKm: tg("unitKm"), unitMin: tg("unitMin"),
        startDay: t("startDay"), all: t("all"), showQr: t("showQr"),
        newSale: t("newSale"), viewClient: tv("view"), callClient: t("callClient"), tourOf: t.raw("tourOf") as string,
        newClient: t("newClient"), phoneOpt: t("phoneOpt"), addressOpt: t("addressOpt"),
        activityOpt: t("activityOpt"), wilayaOpt: t("wilayaOpt"), secteurOpt: t("secteurOpt"),
        tierOpt: t("tierOpt"), useGps: t("useGps"), confirm: t("confirm"),
        cancel: t("cancel"), close: t("cancel"),
        qrReady: t("qrReady"), pendingSync: t("pendingSync"), another: t("another"),
        saveQr: t("saveQr"), qrSaved: t("qrSaved"), qrShared: t("qrShared"), qrSaveFail: t("qrSaveFail"),
        secteurOffline: t("secteurOffline"),
        errOutsideArea: t("errOutsideArea"), errAreaRequired: t("errAreaRequired"),
        collect: t("collect"), amount: t("amount"), syncFirst: t("syncFirst"),
        errSaveFailed: t("errSaveFailed"), queuedOk: t("queuedOk"),
        editClient: t("editClient"), clientUpdated: t("clientUpdated"),
        clientName: t("clientName"),
        errBadPhone: t("errBadPhone"), errDupPhone: t("errDupPhone"),
      }}
    />
  );
}
