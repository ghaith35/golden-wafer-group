import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getLivreurVan } from "../../_data";
import { parseDay } from "../../_days";
import { closeStaleDays } from "@/lib/tournees/service";
import { ensureDayTours } from "@/lib/tournees/plans";
import { pickCurrentTour } from "@/lib/tournees/day-tours";
import { algiersDayKey } from "@/lib/tournees/days";
import { vanDayCash } from "@/lib/cash/daily";
import { DashClient } from "./DashClient";

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
  const date = parseDay(day);
  if (!date) redirect(`/${locale}/livreur`);
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
  const [today, readyCount, dayTours, till] = await Promise.all([
    prisma.sale.aggregate({
      where: {
        companyId: session.companyId,
        locationId: van.id,
        kind: { in: ["DELIVERY", "TICKET"] },
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
      select: { id: true, status: true, startedAt: true, finishedAt: true, autoClosed: true, slot: true, createdAt: true },
    }),
    // Live till math for the auto-filled declaration (from his sales).
    vanDayCash(session.companyId, van.id, date).catch(() => null),
  ]);

  // Up to two tours today: the dashboard follows the one being driven (else the next waiting).
  const tournee = pickCurrentTour(dayTours);

  return (
    <DashClient
      locale={locale}
      day={day}
      vanId={van.id}
      vanName={van.name}
      client={client ? JSON.parse(JSON.stringify(client)) : null}
      dayCount={today._count}
      dayTotal={Number(today._sum.total ?? 0)}
      readyCount={readyCount}
      tournee={tournee ? JSON.parse(JSON.stringify(tournee)) : null}
      dueCash={till ? till.collected + till.clientPayments - till.expenses - till.returnsCash : 0}
      declared={(() => {
        const d = (till?.closeRow as { declared?: unknown } | null)?.declared;
        return d == null ? null : Number(d);
      })()}
      role={session.role}
      labels={{
        title: session.role === "Vendeur" ? t("getCommand") : t("title"), newSale: t("newSale"), factures: t("factures"),
        clients: t("clients"), total: t("total"), stock: t("stock"), stockDepot: t("stockDepot"),
        ready: t("ready"),
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
        newClient: t("newClient"), startDay: t("startDay"), finishDay: t("finishDay"), elapsed: t("elapsed"),
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
