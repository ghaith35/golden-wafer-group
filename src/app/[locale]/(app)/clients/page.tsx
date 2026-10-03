import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { ClientsClient } from "./ClientsClient";

export default async function ClientsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("clients");
  const tc = await getTranslations("common");
  const [clients, secteurs, wilayas, tiers] = await Promise.all([
    prisma.customer.findMany({
      where: { companyId: session.companyId },
      include: { tier: true, secteur: true, wilaya: true },
      orderBy: { name: "asc" },
      take: 500,
    }),
    prisma.secteur.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: { name: "asc" } }),
    prisma.wilaya.findMany({ orderBy: { code: "asc" } }),
    prisma.priceTier.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  return (
    <ClientsClient
      locale={locale}
      initial={JSON.parse(JSON.stringify(clients))}
      secteurs={secteurs}
      wilayas={wilayas}
      tiers={tiers}
      labels={{
        title: t("title"), neW: t("new"), search: tc("search"), qrPrint: t("qrPrint"), empty: t("empty"),
        details: tc("details"), edit: tc("edit"), delete: tc("delete"),
        deleteTitle: tc("deleteTitle"), deleteMessage: tc("deleteMessage"),
        name: t("name"), phone: t("phone"), address: t("address"), wilaya: t("wilaya"),
        secteur: t("secteur"), activity: t("activity"), tier: t("tier"),
        creditLimit: t("creditLimit"), creditDays: t("creditDays"),
        secIdentity: t("secIdentity"), secLocation: t("secLocation"), secBilling: t("secBilling"),
        allS: t("allS"),
        gpsLink: t("gpsLink"), gpsHint: t("gpsHint"), gpsInvalid: t("gpsInvalid"),
        useMyLocation: t("useMyLocation"), gpsDenied: t("gpsDenied"), gps: t("gps"),
        save: tc("save"), cancel: tc("cancel"),
        portalSecret: t("portalSecret"), secretOnce: t("secretOnce"),
        newSecteur: t("newSecteur"), secteurNamePh: t("secteurNamePh"), selectWilayaFirst: t("selectWilayaFirst"),
        qr: t("qr"), print: t("print"), pdf: t("pdf"),
        downloadFile: t("downloadFile"), generating: t("generating"),
      }}
    />
  );
}
