import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { ClosedClient } from "./ClosedClient";

/// Admin: shops the drivers found CLOSED (with the photos they took), grouped
/// by livreur · van · day. Last 90 days.
export default async function ClosedPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  if (session.role !== "Admin") redirect(`/${locale}/livreur`);
  const t = await getTranslations("closed");

  const since = new Date();
  since.setDate(since.getDate() - 90);
  since.setHours(0, 0, 0, 0);
  const rows = await prisma.closedVisit.findMany({
    where: { companyId: session.companyId, occurredAt: { gte: since } },
    orderBy: { occurredAt: "desc" },
    take: 3000,
    select: {
      id: true, occurredAt: true, note: true, lat: true, lng: true,
      customer: { select: { id: true, name: true, code: true, phone: true } },
      location: { select: { id: true, name: true } },
      user: { select: { id: true, fullName: true } },
      photos: { orderBy: { sortOrder: "asc" }, select: { url: true } },
    },
  });

  return (
    <ClosedClient
      locale={locale}
      visits={rows.map((r) => ({
        id: r.id,
        at: r.occurredAt.toISOString(),
        note: r.note,
        lat: r.lat,
        lng: r.lng,
        client: r.customer,
        van: r.location ? { id: r.location.id, name: r.location.name } : null,
        driver: r.user ? { id: r.user.id, name: r.user.fullName } : null,
        photos: r.photos.map((p) => p.url),
      }))}
      labels={{
        title: t("title"), subtitle: t("subtitle"), empty: t("empty"), search: t("search"),
        from: t("from"), to: t("to"), allVans: t("allVans"), allDrivers: t("allDrivers"),
        driver: t("driver"), van: t("van"), day: t("day"), date: t("date"), clients: t("clients"), photos: t("photos"),
        kpiClients: t("kpiClients"), kpiDays: t("kpiDays"), kpiPhotos: t("kpiPhotos"),
        detail: t("detail"), time: t("time"), note: t("note"), openMap: t("openMap"), call: t("call"), unknown: t("unknown"), reset: t("reset"),
      }}
    />
  );
}
