import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getLivreurVan } from "../_data";
import { parseDay, sameDay } from "../_days";
import { DayClients } from "./DayClients";

/// Step 2 — Clients: ALL of the driver's clients (union of his OPEN
/// tournées' stops, tagged by day) with a day-filter on top. Falls back to
/// every active client when nothing is planned yet.
export default async function LivreurDayPage({
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
  const t = await getTranslations("livreur");
  const tg = await getTranslations("tournees");
  const van = await getLivreurVan(session.companyId, session.userId);
  if (!van) redirect(`/${locale}/livreur`);

  const sel = { id: true, name: true, code: true, legacyQr: true, phone: true, tierId: true, balance: true, gpsLat: true, gpsLng: true };
  const tournees = await prisma.tournee.findMany({
    where: { companyId: session.companyId, locationId: van.id, status: "OPEN" },
    include: {
      stops: {
        include: { client: { select: sel } },
        orderBy: { position: "asc" },
      },
    },
    orderBy: { date: "asc" },
  });
  const tour = tournees.find((x) => sameDay(new Date(x.date), date)) ?? null;

  // Union of planned stops across open days, tagged with their day slug.
  const byId = new Map<string, { client: Record<string, unknown>; days: string[] }>();
  const daySlugs: string[] = [];
  for (const tr of tournees) {
    const slug = `${new Date(tr.date).getFullYear()}-${new Date(tr.date).getMonth() + 1}-${new Date(tr.date).getDate()}`;
    if (!daySlugs.includes(slug)) daySlugs.push(slug);
    for (const s of tr.stops) {
      if (!s.client) continue;
      const row = byId.get(s.client.id);
      if (row) {
        if (!row.days.includes(slug)) row.days.push(slug);
      } else {
        byId.set(s.client.id, { client: s.client as unknown as Record<string, unknown>, days: [slug] });
      }
    }
  }
  let clients = [...byId.values()].map((r) => ({ ...r.client, days: r.days }));
  if (!clients.length) {
    const all = await prisma.customer.findMany({
      where: { companyId: session.companyId, isActive: true },
      select: sel,
      orderBy: { name: "asc" },
      take: 500,
    });
    clients = all.map((c) => ({ ...c, days: [] as string[] }));
  }

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

  return (
    <DayClients
      locale={locale}
      day={day}
      vanName={van.name}
      hasTournee={!!tour}
      hasStarted={!!tour?.startedAt}
      days={daySlugs}
      clients={JSON.parse(JSON.stringify(clients))}
      companyId={session.companyId}
      refs={JSON.parse(JSON.stringify({ wilayas, secteurs, tiers }))}
      role={session.role}
      labels={{
        clients: t("clients"), searchClient: t("searchClient"), empty: t("empty"),
        online: t("online"), offline: t("offline"),
        noTournee: t("noTournee"), skip: t("skip"), actualiser: t("actualiser"),
        locate: tg("locate"), geoDenied: tg("geoDenied"),
        unitM: tg("unitM"), unitKm: tg("unitKm"), unitMin: tg("unitMin"),
        startDay: t("startDay"), all: t("all"), showQr: t("showQr"),
        newSale: t("newSale"),
        newClient: t("newClient"), phoneOpt: t("phoneOpt"), addressOpt: t("addressOpt"),
        activityOpt: t("activityOpt"), wilayaOpt: t("wilayaOpt"), secteurOpt: t("secteurOpt"),
        tierOpt: t("tierOpt"), useGps: t("useGps"), confirm: t("confirm"),
        cancel: t("cancel"), close: t("cancel"),
        qrReady: t("qrReady"), pendingSync: t("pendingSync"), another: t("another"),
        saveQr: t("saveQr"), qrSaved: t("qrSaved"), qrShared: t("qrShared"), qrSaveFail: t("qrSaveFail"),
        secteurOffline: t("secteurOffline"),
        collect: t("collect"), amount: t("amount"), syncFirst: t("syncFirst"),
        errSaveFailed: t("errSaveFailed"), queuedOk: t("queuedOk"),
        editClient: t("editClient"), clientUpdated: t("clientUpdated"),
        clientName: t("clientName"),
        errBadPhone: t("errBadPhone"), errDupPhone: t("errDupPhone"),
      }}
    />
  );
}
