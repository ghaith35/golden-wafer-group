import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { VansClient } from "./VansClient";

export default async function VansPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("vans");
  const tc = await getTranslations("common");
  const [vans, users] = await Promise.all([
    prisma.store.findMany({
      where: { companyId: session.companyId, kind: "VAN" },
      include: { user: { select: { id: true, fullName: true, username: true } } },
      orderBy: { name: "asc" },
      take: 100,
    }),
    prisma.user.findMany({
      where: { companyId: session.companyId, isActive: true },
      select: { id: true, fullName: true, username: true },
      orderBy: { fullName: "asc" },
    }),
  ]);
  return (
    <VansClient
      locale={locale}
      initial={JSON.parse(JSON.stringify(vans))}
      users={users}
      labels={{
        title: t("title"), neW: t("new"), search: tc("search"), empty: t("empty"),
        details: tc("details"), edit: tc("edit"), delete: tc("delete"),
        deleteTitle: tc("deleteTitle"), deleteMessage: tc("deleteMessage"),
        name: t("name"), marque: t("marque"), matricule: t("matricule"),
        chauffeur: t("chauffeur"), noChauffeur: t("noChauffeur"),
        addImage: t("addImage"), removeImage: t("removeImage"),
        save: tc("save"), cancel: tc("cancel"), stockBoard: t("stockBoard"),
        driverBusy: t("driverBusy"),
      }}
    />
  );
}
