import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getLivreurVan } from "../../../_data";
import { parseDay } from "../../../_days";
import { todayJourneeTour } from "@/lib/tournees/journee-today";
import { closedClientIdsToday } from "@/lib/closed-visits/service";
import { loadClientStats } from "@/lib/livreur/client-stats";
import { ClientView } from "./ClientView";

/// Client display: one responsive screen with everything about a client —
/// identity, debt, actions (sale / order / closed / sync), sales statistics,
/// top products, this month's offers and the client's invoices.
export default async function LivreurClientPage({
  params,
}: {
  params: Promise<{ locale: string; day: string; id: string }>;
}) {
  const { locale, day, id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  if (!parseDay(day)) redirect(`/${locale}/livreur`);
  const van = await getLivreurVan(session.companyId, session.userId);
  if (!van) redirect(`/${locale}/livreur`);

  const t = await getTranslations("livreur");
  const tv = await getTranslations("clientView");
  const tc = await getTranslations("sync");

  // A client registered on this phone and not synced yet has no server row:
  // the view resolves it on-device and shows an empty history.
  const pending = id.startsWith("pending:");
  const row = pending
    ? null
    : await prisma.customer.findFirst({
        where: { id, companyId: session.companyId },
        select: {
          id: true, name: true, code: true, phone: true, address: true, activityType: true,
          gpsLat: true, gpsLng: true, balance: true, createdAt: true,
          tier: { select: { name: true } },
          secteur: { select: { name: true } },
          wilaya: { select: { nameAr: true, nameFr: true } },
        },
      });
  if (!pending && !row) redirect(`/${locale}/livreur/${day}`);

  const [stats, closedToday, jTour] = await Promise.all([
    row ? loadClientStats(session.companyId, van.id, row.id, locale) : Promise.resolve(null),
    closedClientIdsToday(session.companyId, van.id).catch(() => [] as string[]),
    todayJourneeTour(session.companyId, van.id).catch(() => null),
  ]);

  const client = row
    ? {
        id: row.id, name: row.name, code: row.code, phone: row.phone, address: row.address,
        activity: row.activityType, gpsLat: row.gpsLat, gpsLng: row.gpsLng,
        balance: Number(row.balance), tier: row.tier?.name ?? null, sector: row.secteur?.name ?? null,
        wilaya: row.wilaya ? (locale === "ar" ? row.wilaya.nameAr : row.wilaya.nameFr) : null,
        since: row.createdAt.toISOString(),
      }
    : null;

  return (
    <ClientView
      locale={locale}
      day={day}
      clientId={id}
      client={client}
      stats={stats}
      closed={closedToday.includes(id)}
      closedToday={closedToday}
      hasStarted={!!jTour?.startedAt && !jTour?.finishedAt}
      role={session.role}
      labels={{
        online: t("online"), offline: t("offline"),
        back: tv("back"), view: tv("view"),
        newSale: t("newSale"), newCommand: t("newCommand"), syncT: t("syncT"),
        pending: tc("pending"), lastSync: tc("lastSync"), synced: tc("synced"),
        closedShop: t("closedShop"), closedAddPhoto: t("closedAddPhoto"), closedSave: t("closedSave"), closedHint: t("closedHint"),
        closedBadge: t("closedBadge"), closedErr: t("closedErr"), closedShoot: t("closedShoot"), closedCancel: t("closedCancel"), closedSaved: t("closedSaved"), closedSavedOffline: t("closedSavedOffline"),
        closedNeedStart: t("closedNeedStart"), closedToday: t("closedToday"),
        callClient: t("callClient"),
        debt: tv("debt"), noDebt: tv("noDebt"), credit: tv("credit"),
        monthSold: tv("monthSold"), totalSold: tv("totalSold"), invoices: tv("invoices"), avgTicket: tv("avgTicket"),
        lastSale: tv("lastSale"), never: tv("never"), vsLast: tv("vsLast"), last6: tv("last6"),
        topProducts: tv("topProducts"), noProducts: tv("noProducts"),
        offersMonth: tv("offersMonth"), noOffers: tv("noOffers"), freeUnits: tv("freeUnits"),
        invoicesTitle: tv("invoicesTitle"), noInvoices: tv("noInvoices"), paid: tv("paid"), due: tv("due"), onHold: tv("onHold"),
        phone: tv("phone"), address: tv("address"), sector: tv("sector"), activity: tv("activity"), tier: tv("tier"),
        since: tv("since"), navigate: tv("navigate"), unsynced: tv("unsynced"), units: tv("units"),
        thisMonth: tv("thisMonth"),
      }}
    />
  );
}
