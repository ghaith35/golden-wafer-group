import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getOrCreateSettings } from "@/lib/settings/helpers";
import { expireRules } from "@/lib/threepack/service";
import { getLivreurVan } from "../../_data";
import { parseDay } from "../../_days";
import { GiftsClient } from "./GiftsClient";

/// الهدايا — every running / upcoming gift promotion (buy → get), with its
/// dates. Server-rendered into the page (cached for offline by the journée
/// warm-up); the client re-checks the dates on the phone's own clock so an
/// expired promotion disappears even from a cached copy.
export default async function LivreurGiftsPage({
  params,
}: {
  params: Promise<{ locale: string; day: string }>;
}) {
  const { locale, day } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  if (!parseDay(day)) redirect(`/${locale}/livreur`);
  const van = await getLivreurVan(session.companyId, session.userId);
  if (!van) redirect(`/${locale}/livreur`);
  const settings = await getOrCreateSettings(session.companyId);
  if (!settings.threePackEnabled) redirect(`/${locale}/livreur/${day}/dashboard`);
  const t = await getTranslations("livreur");
  const tt = await getTranslations("threepack");

  await expireRules(session.companyId);
  const rules = await prisma.threePackRule.findMany({
    where: { companyId: session.companyId, isActive: true, isArchived: false },
    orderBy: { createdAt: "desc" },
    include: {
      items: {
        include: {
          product: { select: { id: true, name: true, images: { orderBy: { sortOrder: "asc" }, select: { url: true } } } },
        },
      },
    },
  });

  return (
    <GiftsClient
      locale={locale}
      day={day}
      rules={rules.map((r) => ({
        id: r.id,
        name: r.name,
        mode: r.mode as "SINGLE" | "PACK" | "PERCENT" | "PRICE",
        percent: r.percent != null ? Number(r.percent) : null,
        startsAt: r.startsAt ? r.startsAt.toISOString() : null,
        endsAt: r.endsAt ? r.endsAt.toISOString() : null,
        items: r.items.map((i) => ({
          role: i.role as "BUY" | "GIVE",
          productId: i.productId,
          name: i.product.name,
          images: i.product.images.map((x) => x.url),
          colis: Number(i.colis),
          price: i.price != null ? Number(i.price) : null,
        })),
      }))}
      labels={{
        title: t("giftsTitle"), live: t("giftsLive"), upcoming: t("giftsUpcoming"), buy: t("giftsBuy"), get: t("giftsGet"),
        free: t("giftsFree"), from: t("giftsFrom"), to: t("giftsTo"), openEnded: t("giftsOpenEnded"),
        endsToday: t("giftsEndsToday"), daysLeft: t.raw("giftsDaysLeft") as string, startsIn: t.raw("giftsStartsIn") as string, startsTomorrow: t("giftsStartsTomorrow"),
        empty: t("giftsEmpty"), emptyUpcoming: t("giftsEmptyUpcoming"), single: t("giftsSingle"), pack: t("giftsPack"),
        every: t("giftsEvery"), colis: t("giftsColis"), refresh: t("gpsRefresh"),
        dealPercent: t("giftsDealPercent"), dealPrice: t("giftsDealPrice"), onTargets: t("giftsOnTargets"),
        dealEvery: tt("dealEvery"), priceUnit: tt("priceUnit"),
      }}
    />
  );
}
