import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getLivreurVan } from "../../_data";
import { parseDay, todaySlug } from "../../_days";
import { closeStaleDays } from "@/lib/tournees/service";
import { ensureDayTours } from "@/lib/tournees/plans";
import { pickCurrentTour } from "@/lib/tournees/day-tours";
import { algiersDayKey } from "@/lib/tournees/days";
import { vanDayCash } from "@/lib/cash/daily";
import { DashClient } from "./DashClient";
import { closedClientIdsToday } from "@/lib/closed-visits/service";
import { loadAreaScope } from "@/lib/users/area-scope.server";

/// Step 3 — Dashboard hub: sale, factures, commande, commandes, stock, sync.
export default async function LivreurDashPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; day: string }>;
  searchParams: Promise<{ client?: string }>;
}) {
  const { locale, day } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  if (!parseDay(day)) redirect(`/${locale}/livreur`);
  // The journée dashboard is ALWAYS today's (départ, sales, cash, stock): the
  // picked day in the URL only decides which clients are shown elsewhere.
  const date = parseDay(todaySlug())!;
  const t = await getTranslations("livreur");
  const tc = await getTranslations("sync");
  const tm = await getTranslations("cashDaily");
  const van = await getLivreurVan(session.companyId, session.userId);
  if (!van) redirect(`/${locale}/livreur`);

  const client = sp.client
    ? await prisma.customer.findFirst({
        where: { id: sp.client, companyId: session.companyId },
        select: { id: true, name: true, code: true, phone: true, gpsLat: true, gpsLng: true, tierId: true, balance: true },
      })
    : null;

  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);
  await closeStaleDays(session.companyId).catch(() => {});
  // Recurring plans generate this day's tours on demand (one or two per van).
  await ensureDayTours(session.companyId, van.id, algiersDayKey(dayStart)).catch(() => {});
  // Reference lists for the new-client popup (same as the clients screen).
  const [wilayas, secteurs, tiers, areaScope] = await Promise.all([
    prisma.wilaya.findMany({ orderBy: { code: "asc" } }),
    prisma.secteur.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: { name: "asc" } }),
    prisma.priceTier.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: { sortOrder: "asc" } }),
    loadAreaScope(session.userId, session.role),
  ]);
  const [todayAll, readyCount, dayTours, till] = await Promise.all([
    prisma.sale.aggregate({
      where: {
        companyId: session.companyId,
        locationId: van.id,
        kind: { in: ["DELIVERY", "TICKET"] },
        // Real invoices only — same rule as the van's cash till (vanDayCash):
        // cancelled (and unsaved draft) sales never count.
        status: { notIn: ["CANCELLED", "DRAFT"] },
        date: { gte: dayStart, lte: dayEnd },
      },
      _sum: { total: true },
      _count: true,
    }),
    prisma.sale.count({
      where: { companyId: session.companyId, kind: "ORDER", status: "CONFIRMED", locationId: van.id },
    }),
    prisma.tournee.findMany({
      where: { companyId: session.companyId, locationId: van.id, date: { gte: dayStart, lte: dayEnd } },
      select: { id: true, status: true, startedAt: true, finishedAt: true, autoClosed: true, slot: true, createdAt: true, secteurId: true },
    }),
    // Live till math for the auto-filled declaration (from his sales).
    vanDayCash(session.companyId, van.id, date).catch(() => null),
  ]);

  // Handover: once the admin has RECEIVED the cash (fully) or CLOSED the day, the
  // driver's screen starts clean — counters, amount due and the declaration only
  // reflect what happened AFTER that moment (his next tour). The admin keeps the
  // whole day on the cash screen.
  const dueAll = till ? till.collected + till.clientPayments - till.expenses - till.returnsCash : 0;
  const remittedAll = till?.remittedLive ?? 0;
  const closeRow = (till?.closeRow ?? null) as { status?: string; closedAt?: Date | string | null; declared?: unknown } | null;
  let handoverAt: Date | null = null;
  if (closeRow?.status === "CLOSED" && closeRow.closedAt) {
    handoverAt = new Date(closeRow.closedAt);
  } else if (remittedAll > 0 && remittedAll >= dueAll - 0.01) {
    const last = await prisma.versement.findFirst({
      where: { companyId: session.companyId, locationId: van.id, kind: "CASH_COLLECTION", date: { gte: dayStart, lte: dayEnd } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    handoverAt = last?.createdAt ?? null;
  }
  const today = handoverAt
    ? await prisma.sale.aggregate({
        where: {
          companyId: session.companyId,
          locationId: van.id,
          kind: { in: ["DELIVERY", "TICKET"] },
          status: { notIn: ["CANCELLED", "DRAFT"] },
          date: { gt: handoverAt, lte: dayEnd },
        },
        _sum: { total: true },
        _count: true,
      })
    : todayAll;

  // Up to two tours today: the dashboard follows the one being driven (else the next waiting).
  const tournee = pickCurrentTour(dayTours);
  const closedToday = await closedClientIdsToday(session.companyId, van.id).catch(() => [] as string[]);

  return (
    <DashClient
      locale={locale}
      day={day}
      vanId={van.id}
      vanName={van.name}
      client={client ? JSON.parse(JSON.stringify(client)) : null}
      closedToday={closedToday}
      dayCount={today._count}
      dayTotal={Number(today._sum.total ?? 0)}
      readyCount={readyCount}
      tournee={tournee ? JSON.parse(JSON.stringify(tournee)) : null}
      dueCash={handoverAt ? Math.max(0, dueAll - remittedAll) : dueAll}
      declared={handoverAt ? null : (() => {
        const d = closeRow?.declared;
        return d == null ? null : Number(d);
      })()}
      role={session.role}
      newClientRefs={{
        companyId: session.companyId,
        refs: JSON.parse(JSON.stringify({ wilayas, secteurs, tiers })),
        areaScope,
        defaultSecteurId: tournee?.secteurId ?? null,
      }}
      labels={{
        closedShop: t("closedShop"), closedAddPhoto: t("closedAddPhoto"), closedSave: t("closedSave"), closedHint: t("closedHint"),
        closedBadge: t("closedBadge"), closedErr: t("closedErr"), closedShoot: t("closedShoot"), closedCancel: t("closedCancel"), closedSaved: t("closedSaved"), closedSavedOffline: t("closedSavedOffline"),
        closedNeedStart: t("closedNeedStart"), closedToday: t("closedToday"), closedCamFail: t("closedCamFail"),
        title: session.role === "Vendeur" ? t("getCommand") : t("title"), newSale: t("newSale"), factures: t("factures"),
        clients: t("clients"), total: t("total"), stock: t("stock"), stockDepot: t("stockDepot"),
        ready: t("ready"),
        gps: t("gpsTitle"), gpsLocating: t("gpsLocating"), gpsNoPos: t("gpsNoPos"), gpsRefresh: t("gpsRefresh"),
        newCommand: t("newCommand"), commandes: t("commandes"), syncT: t("syncT"),
        pending: tc("pending"), lastSync: tc("lastSync"), syncNow: tc("syncNow"), synced: tc("synced"),
        syncTitle: tc("syncTitle"), syncUpload: tc("upload"), syncDownload: tc("download"),
        syncImages: tc("images"), syncApplied: tc("applied"), syncFailed: tc("failed"),
        syncRemaining: tc("remaining"), syncStart: tc("start"), syncClose: tc("close"),
        syncUp: tc("up"), syncDown: tc("down"),
        syncHistory: tc("history"), syncNoHistory: tc("noHistory"), syncClearHistory: tc("clearHistory"),
        syncCamNeedHttps: tc("camNeedHttps"), syncCamDenied: tc("camDenied"), syncCamUnsupported: tc("camUnsupported"),
        syncDirectSync: tc("directSync"), syncNoVan: tc("noVan"),
        syncUpdateTitle: tc("updateTitle"), syncCheckUpdate: tc("checkUpdate"),
        syncWebOk: tc("webOk"), syncWebNew: tc("webNew"), syncUpdateNow: tc("updateNow"),
        syncDownloadApk: tc("downloadApk"), syncApkHint: tc("apkHint"),
        syncSetupHint: tc("setupHint"), syncScanSetup: tc("scanSetup"), syncManual: tc("manual"),
        syncGallery: tc("gallery"), syncQrNotFound: tc("qrNotFound"), syncInvalidQr: tc("invalidQr"),
        syncTokenPh: tc("tokenPh"), syncUrlPh: tc("urlPh"), syncTokenRequired: tc("tokenRequired"),
        syncSaveConfig: tc("saveConfig"), syncResetConfig: tc("resetConfig"),
        syncServerTitle: tc("serverTitle"), syncChangeServer: tc("changeServer"),
        syncServerScanHint: tc("serverScanHint"), syncServerPendingBlock: tc("serverPendingBlock"),
        syncServerQuarantined: tc("serverQuarantined"), syncServerReset: tc("serverReset"),
        syncOfflineReady: tc("offlineReady"), syncOfflineNotReady: tc("offlineNotReady"),
        syncWebUpdateTitle: tc("webUpdateTitle"), syncWebLater: tc("webLater"), syncWebValidate: tc("webValidate"),
        syncNativeTitle: tc("nativeTitle"), syncNativeGo: tc("nativeGo"),
        newClient: t("newClient"), clientName: t("clientName"), phoneOpt: t("phoneOpt"), addressOpt: t("addressOpt"),
        activityOpt: t("activityOpt"), wilayaOpt: t("wilayaOpt"), secteurOpt: t("secteurOpt"),
        tierOpt: t("tierOpt"), tierBase: t("tierBase"), useGps: t("useGps"), confirm: t("confirm"),
        qrReady: t("qrReady"), pendingSync: t("pendingSync"), another: t("another"),
        saveQr: t("saveQr"), qrSaved: t("qrSaved"), qrShared: t("qrShared"), qrSaveFail: t("qrSaveFail"),
        secteurOffline: t("secteurOffline"), errOutsideArea: t("errOutsideArea"), errAreaRequired: t("errAreaRequired"), startDay: t("startDay"), finishDay: t("finishDay"), elapsed: t("elapsed"),
        online: t("online"), offline: t("offline"),
        dayQueued: t("dayQueued"), noTournee: t("noTournee"), autoClosedDay: t("autoClosedDay"),
        declare: t("declare"), declaredOk: t("declaredOk"), queuedOk: t("queuedOk"),
        recapSales: t("recapSales"), recapDue: t("recapDue"), recapDeclared: t("recapDeclared"),
        recapNotDeclared: t("recapNotDeclared"), recapPending: t("recapPending"),
        expense: t("expense"), expenseLabel: t("expenseLabel"), dueHint: t("dueHint"),
        amount: tm("amount"), notes: tm("notes"), save: tm("save"), cancel: tm("cancel"),
        transferts: t("transferts"), reject: t("reject"), errSaveFailed: t("errSaveFailed"),
        noTransfers: t("noTransfers"), restock: t("restock"),
        syncClockSkew: tc("clockSkew"),
        warmTitle: tc("warmTitle"), warmHint: tc("warmHint"),
        warmSync: tc("warmSync"), warmPages: tc("warmPages"), warmMedia: tc("warmMedia"),
        warmDone: tc("warmDone"), warmDoneHint: tc("warmDoneHint"),
        warmPairNeeded: tc("warmPairNeeded"), warmPairHint: tc("warmPairHint"),
        warmOpenSync: tc("warmOpenSync"), warmRetry: tc("warmRetry"),
      }}
    />
  );
}
