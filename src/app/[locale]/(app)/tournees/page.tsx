import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { sortByName } from "@/lib/sort";
import { closeStaleDays } from "@/lib/tournees/service";
import { materializePlans, listPlans, LOOKAHEAD_DAYS } from "@/lib/tournees/plans";
import { addDaysKey, algiersDayKey, weekStartKey } from "@/lib/tournees/days";
import { TourneesClient } from "./TourneesClient";

export default async function TourneesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("tournees");
  const tc = await getTranslations("common");
  // Past unfinished journées end here, flagged — the week grid marks them.
  await closeStaleDays(session.companyId).catch(() => {});
  // Recurring plans generate their daily tours on demand (also converts the old
  // 12-week copies into endless plans, once): this week and the next weeks.
  const todayKey = algiersDayKey(new Date());
  const weekKey = weekStartKey(todayKey);
  await materializePlans(session.companyId, { fromKey: weekKey, toKey: addDaysKey(weekKey, 6 + LOOKAHEAD_DAYS) }).catch(() => {});
  const plans = await listPlans(session.companyId);
  const rows = await prisma.tournee.findMany({
    where: { companyId: session.companyId },
    include: {
      location: true,
      secteur: true,
      stops: {
        select: {
          id: true, visited: true, sold: true, skipped: true,
          client: { select: { id: true, name: true, code: true, gpsLat: true, gpsLng: true } },
        },
        orderBy: { position: "asc" },
      },
    },
    orderBy: [{ date: "desc" }, { slot: "asc" }],
    take: 500,
  });
  const vans = await prisma.store.findMany({
    where: { companyId: session.companyId, kind: "VAN", isActive: true },
    select: {
      id: true, name: true, marque: true, matricule: true, imageUrl: true,
      user: { select: { fullName: true } },
    },
    orderBy: { name: "asc" },
  });
  return (
    <TourneesClient
      locale={locale}
      initial={JSON.parse(JSON.stringify(rows))}
      vans={sortByName(vans, locale)}
      plans={plans}
      isAdmin={session.role === "Admin"}
      labels={{
        title: t("title"), neW: t("new"), empty: t("empty"), search: tc("search"),
        stops: t("stops"), visited: t("visited"), sold: t("sold"),
        open: t("open"), closed: t("closed"), today: t("today"), all: t("all"),
        optimize: t("optimize"), close: t("close"), report: t("report"),
        carryover: t("carryover"), sell: t("sell"),
        moveTitle: t("moveTitle"), moveMessage: t("moveMessage"), moveConfirm: t("moveConfirm"),
        tClients: t("tClients"), tDistance: t("tDistance"), tTime: t("tTime"),
        locate: t("locate"), geoDenied: t("geoDenied"), unitM: t("unitM"), unitKm: t("unitKm"),
        unitMin: t("unitMin"), geoManual: t("geoManual"),
        edit: tc("edit"), delete: tc("delete"),
        deleteTitle: tc("deleteTitle"), deleteMessage: tc("deleteMessage"),
        unclosed: t("unclosed"),
        save: tc("save"), cancel: tc("cancel"),
        weekday: t("weekday"), van: t("van"), secteur: t("secteur"), notes: tc("notes"),
        autofill: t("fill"), clear: tc("cancel"),
        missingFields: t("missingFields"), duplicateDay: t("duplicateDay"),
        secteurRequired: t("secteurRequired"), allClients: t("allClients"),
        actionFailed: t("actionFailed"),
        frequency: t("frequency"), freqWeekly: t("freqWeekly"), freqWeeklyHint: t("freqWeeklyHint"),
        freqBiweekly: t("freqBiweekly"), freqBiweeklyHint: t("freqBiweeklyHint"),
        pickSector: t("pickSector"), week1: t("week1"), thenEvery2: t("thenEvery2"),
        removeDay: t("removeDay"), endPlan: t("endPlan"), endPlanHint: t("endPlanHint"), removeDayHint: t("removeDayHint"),
        planEndTitle: t("planEndTitle"), nextOn: t("nextOn"), cellFull: t("cellFull"), weeklyTag: t("weeklyTag"), biweeklyTag: t("biweeklyTag"),
        prevWeek: t("prevWeek"), nextWeek: t("nextWeek"),
      }}
    />
  );
}
