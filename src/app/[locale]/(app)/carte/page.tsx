import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { CarteClient } from "./CarteClient";

export default async function CartePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("carte");
  const tc = await getTranslations("common");
  const tcl = await getTranslations("clients");
  const [clients, secteurs] = await Promise.all([
    prisma.customer.findMany({
      where: { companyId: session.companyId, gpsLat: { not: null }, gpsLng: { not: null } },
      select: {
        id: true, code: true, name: true, phone: true, gpsLat: true, gpsLng: true,
        secteur: { select: { name: true } }, wilaya: { select: { code: true, nameAr: true } },
      },
      orderBy: { name: "asc" },
      take: 500,
    }),
    prisma.secteur.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <CarteClient
      initial={clients.map((c) => ({ ...c, gpsLat: Number(c.gpsLat), gpsLng: Number(c.gpsLng) }))}
      secteurs={secteurs}
      labels={{
        title: t("title"), search: tc("search"), empty: t("empty"), openMaps: tcl("openMaps"),
        tabClient: t("tabClient"), tabWilaya: t("tabWilaya"), tabSecteur: t("tabSecteur"),
        allWilayas: t("allWilayas"), allSecteurs: t("allSecteurs"),
        openTour: t("openTour"), prev: t("prev"), next: t("next"), count: t("count"),
      }}
    />
  );
}
