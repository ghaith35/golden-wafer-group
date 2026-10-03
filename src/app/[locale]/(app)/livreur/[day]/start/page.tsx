import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getLivreurVan } from "../../_data";
import { parseDay } from "../../_days";
import { StartClient } from "./StartClient";

/// Interstitial after picking a day: live clock + validate to start.
export default async function LivreurStartPage({
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
  const van = await getLivreurVan(session.companyId, session.userId);
  if (!van) redirect(`/${locale}/livreur`);

  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);
  const tournee = await prisma.tournee.findFirst({
    where: { companyId: session.companyId, locationId: van.id, date: { gte: dayStart, lte: dayEnd } },
    select: { id: true, startedAt: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <StartClient
      locale={locale}
      day={day}
      dateIso={date.toISOString()}
      vanName={van.name}
      tourneeId={tournee?.id ?? null}
      startedAt={tournee?.startedAt ? new Date(tournee.startedAt).toISOString() : null}
      labels={{ startDay: t("startDay"), clients: t("clients"), gpsWhy: t("gpsWhy"), gpsDenied: t("gpsDenied"), gpsGranted: t("gpsGranted") }}
    />
  );
}
