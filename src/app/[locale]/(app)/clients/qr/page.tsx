import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { QrPrintClient } from "./QrPrintClient";

export default async function QrPrintPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("clients");
  const tc = await getTranslations("common");
  const [wilayas, secteurs] = await Promise.all([
    prisma.wilaya.findMany({ orderBy: { code: "asc" } }),
    prisma.secteur.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <QrPrintClient
      locale={locale}
      wilayas={wilayas}
      secteurs={secteurs}
      labels={{ title: t("qrPrintTitle"), selectAll: t("selectAll"), print: t("print"), search: tc("search") }}
    />
  );
}
