import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { SuppliersClient } from "./SuppliersClient";

export default async function SuppliersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("suppliers");
  const tc = await getTranslations("common");
  const tcl = await getTranslations("clients");
  const [rows, wilayas, secteurs] = await Promise.all([
    prisma.supplier.findMany({
      where: { companyId: session.companyId },
      include: {
        wilaya: { select: { code: true, nameAr: true } },
        secteur: { select: { name: true } },
      },
      orderBy: { name: "asc" },
      take: 300,
    }),
    prisma.wilaya.findMany({ orderBy: { code: "asc" } }),
    prisma.secteur.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <SuppliersClient
      locale={locale}
      initial={JSON.parse(JSON.stringify(rows))}
      wilayas={wilayas}
      secteurs={secteurs}
      labels={{
        title: t("title"), neW: t("new"), search: tc("search"), empty: t("empty"),
        balance: t("balance"),
        details: tc("details"), edit: tc("edit"), delete: tc("delete"),
        deleteTitle: tc("deleteTitle"), deleteMessage: tc("deleteMessage"),
        name: tcl("name"), phone: tcl("phone"), address: tcl("address"),
        notes: t("notes"), save: tc("save"), cancel: tc("cancel"),
        secIdentity: tcl("secIdentity"), secLocation: tcl("secLocation"),
        wilaya: tcl("wilaya"), secteur: tcl("secteur"), allS: tcl("allS"),
      }}
    />
  );
}
