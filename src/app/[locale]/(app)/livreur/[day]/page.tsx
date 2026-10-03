import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getLivreurVan } from "../_data";
import { parseDay, sameDay } from "../_days";
import { DayClients } from "./DayClients";

/// Step 2 — Clients of the day (tournee stops, else all clients).
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

  const sel = { id: true, name: true, code: true, phone: true, tierId: true, balance: true, gpsLat: true, gpsLng: true };
  const tournees = await prisma.tournee.findMany({
    where: { companyId: session.companyId, locationId: van.id, status: "OPEN" },
    include: {
      stops: {
        include: { client: { select: sel } },
        orderBy: { position: "asc" },
      },
    },
  });
  const tour = tournees.find((x) => sameDay(new Date(x.date), date)) ?? null;
  const clients = tour
    ? tour.stops.map((s) => s.client).filter(Boolean)
    : await prisma.customer.findMany({
        where: { companyId: session.companyId, isActive: true },
        select: sel,
        orderBy: { name: "asc" },
        take: 500,
      });

  return (
    <DayClients
      locale={locale}
      day={day}
      vanName={van.name}
      hasTournee={!!tour}
      clients={JSON.parse(JSON.stringify(clients))}
      labels={{
        clients: t("clients"), searchClient: t("searchClient"), empty: t("empty"),
        noTournee: t("noTournee"), skip: t("skip"), actualiser: t("actualiser"),
        locate: tg("locate"), geoDenied: tg("geoDenied"),
        unitM: tg("unitM"), unitKm: tg("unitKm"), unitMin: tg("unitMin"),
        startDay: t("startDay"),
      }}
    />
  );
}
