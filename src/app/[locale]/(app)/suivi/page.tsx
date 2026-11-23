import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { SuiviClient } from "./SuiviClient";

/// تتبع GPS + الخريطة (merged): live vans and every geolocated client on one
/// map. The old /carte route redirects here.
export default async function SuiviPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("tracking");
  const tc = await getTranslations("carte");
  const tcm = await getTranslations("common");
  const tcl = await getTranslations("clients");
  const [clients, secteurs] = await Promise.all([
    prisma.customer.findMany({
      where: { companyId: session.companyId, gpsLat: { not: null }, gpsLng: { not: null } },
      select: {
        id: true, code: true, name: true, phone: true, gpsLat: true, gpsLng: true,
        secteur: { select: { name: true } }, wilaya: { select: { code: true, nameAr: true } },
      },
      orderBy: { name: "asc" },
      take: 1500,
    }),
    prisma.secteur.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <SuiviClient
      clients={clients.map((c) => ({ ...c, gpsLat: Number(c.gpsLat), gpsLng: Number(c.gpsLng) }))}
      secteurs={secteurs.map((s) => ({ id: s.id, name: s.name }))}
      labels={{
        title: t("title"), refresh: t("refresh"), autoRefresh: t("autoRefresh"),
        online: t("online"), stale: t("stale"), offline: t("offline"), noSignal: t("noSignal"),
        lastSeen: t("lastSeen"), driver: t("driver"), empty: t("empty"), neverSeen: t("neverSeen"),
        locate: t("locate"), locateSent: t("locateSent"),
        tabVans: t("tabVans"), layerVans: t("layerVans"), layerClients: t("layerClients"), layerZone: t("layerZone"),
        colorByVan: t("colorByVan"), pickVanHint: t("pickVanHint"),
        color_near: t("color_near"), color_mid: t("color_mid"), color_far: t("color_far"),
        nearestVan: t("nearestVan"), googleView: t("googleView"), mapView: t("mapView"), emptyClients: t("emptyClients"),
        search: tcm("search"), openMaps: tcl("openMaps"),
        tabClient: tc("tabClient"), tabWilaya: tc("tabWilaya"), tabSecteur: tc("tabSecteur"),
        allWilayas: tc("allWilayas"), allSecteurs: tc("allSecteurs"),
        openTour: tc("openTour"), prev: tc("prev"), next: tc("next"), count: tc("count"),
      }}
    />
  );
}
