import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { UsersClient } from "./UsersClient";

// Standalone section: /[locale]/users (Livreur / Pré-vendeur) —
// staff accounts only (create + modify, no delete). Admin accounts are
// managed exclusively in Settings → Admins.
export default async function UsersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  if (session.role !== "Admin") redirect(`/${locale}/dashboard`);
  const t = await getTranslations("users");
  const tc = await getTranslations("common");
  const vans = await prisma.store.findMany({
    where: { companyId: session.companyId, kind: "VAN", isActive: true },
    orderBy: { name: "asc" },
  });
  const [wilayas, secteurs] = await Promise.all([
    prisma.wilaya.findMany({ orderBy: { code: "asc" } }),
    prisma.secteur.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <UsersClient
      locale={locale}
      vans={vans}
      geo={{
        wilayas: wilayas.map((w) => ({ code: w.code, nameFr: w.nameFr, nameAr: w.nameAr })),
        secteurs: secteurs.map((x) => ({ id: x.id, name: x.name, wilayaCode: x.wilayaCode })),
      }}
      allowedRoles={["Vendeur", "Livreur"]}
      allowDelete
      scope="staff"
      labels={{
        title: t("title"), username: t("username"), password: t("password"),
        fullName: t("fullName"), phone: t("phone"), van: t("van"), add: tc("add"), empty: t("empty"),
        search: tc("search"), edit: tc("edit"), delete: tc("delete"),
        deleteTitle: tc("deleteTitle"), deleteMessage: tc("deleteMessage"),
        save: tc("save"), cancel: tc("cancel"), active: tc("active"),
        inactive: tc("inactive"), qrCode: t("qrCode"), qrRegenerate: t("qrRegenerate"),
        showPw: t("showPw"), hidePw: t("hidePw"),
        emptyTitle: t("emptyTitle"), emptyHint: t("emptyHint"),
        roleVendeur: t("roleVendeur"), roleLivreur: t("roleLivreur"), roleAdmin: t("roleAdmin"),
        firstAdd: t("firstAdd"), goAdmins: t("goAdmins"), goHref: `/${locale}/settings/admins`,
        all: t("all"), driverBusy: t("driverBusy"),
        areas: t("areas"), areasAll: t("areasAll"), areasHint: t("areasHint"), areasClear: t("areasClear"),
        areasSearch: t("areasSearch"), areasWhole: t("areasWhole"), areasNoSecteurs: t("areasNoSecteurs"),
      }}
    />
  );
}
