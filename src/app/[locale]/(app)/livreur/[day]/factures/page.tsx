import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getOrCreateSettings } from "@/lib/settings/helpers";
import { getLivreurVan } from "../../_data";
import { parseDay } from "../../_days";
import { FacturesClient } from "./FacturesClient";
/// Step 5 — Factures: van tickets, view + cancel.
export default async function LivreurFacturesPage({
  params,
}: {
  params: Promise<{ locale: string; day: string }>;
}) {
  const { locale, day } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  // Mandob (Vendeur): no factures — proxy enforces too.
  if (session.role === "Vendeur") redirect(`/${locale}/livreur/${day}/dashboard`);
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

  const rows = await prisma.sale.findMany({
    where: { companyId: session.companyId, locationId: van.id, kind: "TICKET", status: { not: "CANCELLED" } },
    include: { client: { select: { name: true, gpsLat: true, gpsLng: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <FacturesClient
      isAdmin={session.role === "Admin"}
      locale={locale}
      day={day}
      rows={JSON.parse(JSON.stringify(rows))}
      labels={{
        factures: t("factures"), empty: t("empty"), viewSale: t("viewSale"),
        deleteSale: t("deleteSale"), confirmDelete: t("confirmDelete"),
        yes: t("yes"), no: t("no"), queuedOk: t("queuedOk"),
        print: t("print"), total: t("total"), paid: t("paid"),
        qty: ts("qty"), price: ts("price"), unitPrice: ts("unitPrice"), client: ts("client"), remise: ts("remise"),
        articles: ts("articles"), packs: ts("packs"), dateLbl: tc("date"),
        invClose: t("invClose"), invRemaining: t("invRemaining"), invSettled: t("invSettled"), invPieces: t("invPieces"), invNoLines: t("invNoLines"),
        cancel: t("cancel"), offline: tc("offline"), unsynced: ts("unsynced"),
        factureHold: t("factureHold"), factureConfirmed: t("factureConfirmed"), confirmFacture: t("confirmFacture"),
        confirmFactureTitle: t("confirmFactureTitle"), confirmFactureMsg: t("confirmFactureMsg"),
        factureLocked: t("factureLocked"), facturesSelected: t("facturesSelected"), selectAllFactures: t("selectAllFactures"), bulkFailed: t("bulkFailed"), factureConfirmedOk: t("factureConfirmedOk"),
        discarded: t("discarded"), errForbidden: t("errForbidden"),
        staleData: t("staleData"),
        edit: tc("edit"), save: tc("save"), product: ts("product"), unit: ts("unit"),
        notes: t("notes"), addLine: ts("addLine"),
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
