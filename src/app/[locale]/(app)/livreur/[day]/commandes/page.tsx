import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getLivreurVan } from "../../_data";
import { parseDay } from "../../_days";
import { VanOrdersClient } from "./VanOrdersClient";

/// Livreur commandes: DRAFT + CONFIRMED orders assigned to his van.
/// ?ready=1 → only CONFIRMED (packed, assigned — the "جاهز للتوصيل" section).
export default async function LivreurOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; day: string }>;
  searchParams: Promise<{ ready?: string }>;
}) {
  const { locale, day } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  if (!parseDay(day)) redirect(`/${locale}/livreur`);
  const t = await getTranslations("livreur");
  const ts = await getTranslations("sales");
  const van = await getLivreurVan(session.companyId, session.userId);
  if (!van) redirect(`/${locale}/livreur`);

  const readyOnly = sp.ready === "1";
  const whereBase = { companyId: session.companyId, kind: "ORDER", locationId: van.id } as const;
  const rows = await prisma.sale.findMany({
    where: {
      ...whereBase,
      status: readyOnly ? "CONFIRMED" : { in: ["DRAFT", "CONFIRMED"] },
    },
    include: {
      client: { select: { id: true, name: true, code: true } },
      _count: { select: { lines: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  // Delivered ones stay visible below so the livreur can toggle an order
  // back to "still to be delivered" (reopen) when needed.
  const doneRows = readyOnly ? [] : await prisma.sale.findMany({
    where: { ...whereBase, status: "DELIVERED" },
    include: {
      client: { select: { id: true, name: true, code: true } },
      _count: { select: { lines: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <VanOrdersClient
      locale={locale}
      day={day}
      vanId={van.id}
      rows={JSON.parse(JSON.stringify(rows))}
      doneRows={JSON.parse(JSON.stringify(doneRows))}
      labels={{
        title: readyOnly ? t("ready") : t("commandes"),
        commandes: t("commandes"), empty: t("empty"), total: t("total"),
        deliver: ts("deliver"), paid: t("paid"), cancel: t("cancel"), confirm: t("confirm"), sell: t("newSale"),
        print: t("print"), cancelOrder: ts("cancelOrder"), delivered: ts("delivered"),
      }}
      ticketLabels={{
        total: ts("total"), paid: ts("paid"), due: ts("due"), remise: ts("remise"),
        thanks: ts("thanks"), seller: ts("seller"), client: ts("client"), share: ts("share"),
        packs: ts("packs"), articles: ts("articles"), oldDebt: ts("oldDebt"), newDebt: ts("newDebt"),
        design: ts("product"), qty: ts("qty"), price: ts("price"), unitPrice: ts("unitPrice"),
      }}
    />
  );
}
