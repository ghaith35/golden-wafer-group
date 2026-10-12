import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { listSeasons } from "@/lib/season/seasons";
import { PresenceClient } from "./PresenceClient";
/// Admin view: départ / fin de journée per van and day, with month filter.
export default async function PresencePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("presence");
  const tc = await getTranslations("common");
  const now = new Date();
  const seasons = await listSeasons(session.companyId);
  const years = [...new Set(seasons.map((s) => s.year))].sort((a, b) => b - a);
  const year = Number(sp.year) || now.getFullYear();
  const months = seasons.filter((s) => s.year === year).map((s) => s.month);
  if (!months.includes(now.getMonth() + 1)) months.push(now.getMonth() + 1);
  months.sort((a, b) => b - a);
  const month = months.includes(Number(sp.month)) ? Number(sp.month) : now.getMonth() + 1;
  const rangeStart = new Date(year, month - 1, 1);
  const rangeEnd = new Date(year, month, 1);
  const rows = await prisma.tournee.findMany({
    where: { companyId: session.companyId, date: { gte: rangeStart, lt: rangeEnd } },
    include: {
      location: { select: { id: true, name: true, matricule: true, user: { select: { fullName: true } } } },
    },
    orderBy: { date: "desc" },
    take: 200,
  });
  const settings = await prisma.companySettings.findUnique({
    where: { companyId: session.companyId },
    select: { workStartAt: true, maxDayHours: true },
  });
  return (
    <PresenceClient
      locale={locale}
      year={year}
      month={month}
      years={years.length ? years : [now.getFullYear()]}
      months={months}
      rows={JSON.parse(JSON.stringify(rows))}
      isAdmin={session.role === "Admin"}
      workStartAt={settings?.workStartAt ?? null}
      maxDayHours={settings?.maxDayHours != null ? Number(settings.maxDayHours) : 10}
      labels={{
        title: t("title"), van: t("van"), driver: t("driver"), start: t("start"),
        end: t("end"), duration: t("duration"), empty: t("empty"), open: t("open"),
        week: t("week"), allDays: t("allDays"), late: t("late"), overtime: t("overtime"),
        edit: tc("edit"), save: tc("save"), cancel: tc("cancel"),
      }}
    />
  );
}
