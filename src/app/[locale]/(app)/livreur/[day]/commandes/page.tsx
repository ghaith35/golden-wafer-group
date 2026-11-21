import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getOrCreateSettings } from "@/lib/settings/helpers";
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
  const tc = await getTranslations("common");
  // Ticket language is an admin setting (default French), independent of
  // the UI locale the livreur browses in.
  const settings = await getOrCreateSettings(session.companyId);
  const ticketLang = settings.ticketLang === "ar" ? "ar" : "fr";
  const tt = await getTranslations({ locale: ticketLang, namespace: "sales" });
  const van = await getLivreurVan(session.companyId, session.userId);
  if (!van) redirect(`/${locale}/livreur`);
  const driver = await prisma.user.findFirst({ where: { id: session.userId, companyId: session.companyId }, select: { fullName: true, phone: true } });

  const readyOnly = sp.ready === "1";
  const whereBase = { companyId: session.companyId, kind: "ORDER", locationId: van.id } as const;
  const rows = await prisma.sale.findMany({
    where: {
      ...whereBase,
      status: readyOnly ? "CONFIRMED" : { in: ["DRAFT", "CONFIRMED"] },
    },
    include: {
      client: { select: { id: true, name: true, code: true, gpsLat: true, gpsLng: true } },
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
      client: { select: { id: true, name: true, code: true, gpsLat: true, gpsLng: true } },
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
      role={session.role}
      rows={JSON.parse(JSON.stringify(rows))}
      doneRows={JSON.parse(JSON.stringify(doneRows))}
      labels={{
        title: readyOnly ? t("ready") : t("commandes"),
        commandes: t("commandes"), empty: t("empty"), total: t("total"),
        deliver: ts("deliver"), paid: t("paid"), cancel: t("cancel"), confirm: t("confirm"), sell: t("newSale"),
        print: t("print"), cancelOrder: ts("cancelOrder"), delivered: ts("delivered"),
        queuedOk: t("queuedOk"), offline: tc("offline"),
        discarded: t("discarded"), syncFirst: t("syncFirst"),
        errForbidden: t("errForbidden"), staleData: t("staleData"),
      }}
      ticketLabels={{
        total: tt("total"), paid: tt("paid"), due: tt("due"), remise: tt("remise"),
        thanks: tt("thanks"), seller: tt("seller"), client: tt("client"), share: tt("share"),
        copied: tt("copied"), shareFail: tt("shareFail"),
        printFail: tt("printFail"),
        pdfSaved: tt("pdfSaved"), pdfShared: tt("pdfShared"),
        pdfPreview: tt("pdfPreview"), save: tc("save"),
        packs: tt("packs"), articles: tt("articles"), oldDebt: tt("oldDebt"), newDebt: tt("newDebt"),
        design: tt("product"), qty: tt("qty"), price: tt("price"), unitPrice: tt("unitPrice"),
      }}
      ticketLang={ticketLang}
      driver={driver}
    />
  );
}
