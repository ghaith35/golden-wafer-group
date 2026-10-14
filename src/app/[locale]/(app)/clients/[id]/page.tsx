import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/Card";
import { BackButton } from "@/components/ui/BackButton";
import { ClientForm, type ClientData } from "../ClientForm";
import { SecretReset } from "./SecretReset";

export default async function ClientDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("clients");
  const tc = await getTranslations("common");
  const [client, wilayas, secteurs, tiers] = await Promise.all([
    prisma.customer.findFirst({
      where: { id, companyId: session.companyId },
      include: { tier: true, secteur: true, wilaya: true },
    }),
    prisma.wilaya.findMany({ orderBy: { code: "asc" } }),
    prisma.secteur.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: { name: "asc" } }),
    prisma.priceTier.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  if (!client) notFound();

  const mapsUrl =
    client.gpsLat != null && client.gpsLng != null
      ? `https://www.google.com/maps?q=${client.gpsLat},${client.gpsLng}`
      : null;

  const initial: ClientData = {
    id: client.id,
    name: client.name,
    phone: client.phone ?? "",
    address: client.address ?? "",
    wilayaCode: client.wilayaCode ? String(client.wilayaCode) : "",
    secteurId: client.secteurId ?? "",
    activityType: client.activityType ?? "",
    tierId: client.tierId ?? "",
    creditLimit: Number(client.creditLimit),
    creditDays: client.creditDays,
    gpsLat: client.gpsLat != null ? String(client.gpsLat) : "",
    gpsLng: client.gpsLng != null ? String(client.gpsLng) : "",
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-5 md:p-6 lg:max-w-4xl xl:max-w-5xl">
      <BackButton fallback={`/${locale}/clients`} />
      <h1 className="text-xl font-bold">
        {client.name} <span className="font-mono text-sm opacity-50">{client.code}</span>
      </h1>
      <div className="space-y-4">
        <Card>
          <div className="text-sm"><b>{t("balance")}:</b> <span className="font-black">{String(client.balance)}</span></div>
          <div className="text-sm"><b>{t("tier")}:</b> {client.tier?.name ?? "—"}</div>
          <div className="text-sm"><b>{t("phone")}:</b> {client.phone ?? "—"}</div>
          {mapsUrl && (
            <a href={mapsUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm font-bold text-(--brand-600)">
              📍 {t("openMaps")}
            </a>
          )}
        </Card>
        {client.phone && (
          <SecretReset clientId={client.id} labels={{ portalSecret: t("portalSecret"), resetSecret: t("resetSecret"), secretOnce: t("secretOnce") }} />
        )}
      </div>
      <ClientForm
        locale={locale}
        initial={initial}
        wilayas={wilayas}
        secteurs={secteurs}
        tiers={tiers}
        showQr={false}
        labels={{
          name: t("name"), phone: t("phone"), address: t("address"), wilaya: t("wilaya"), secteur: t("secteur"),
          activity: t("activity"), tier: t("tier"),           creditLimit: t("creditLimit"), creditDays: t("creditDays"),
          gpsLink: t("gpsLink"), gpsHint: t("gpsHint"), gpsInvalid: t("gpsInvalid"), save: tc("save"), cancel: tc("cancel"),
          portalSecret: t("portalSecret"), secretOnce: t("secretOnce"),
          newSecteur: t("newSecteur"), secteurNamePh: t("secteurNamePh"), selectWilayaFirst: t("selectWilayaFirst"),
        }}
      />
    </div>
  );
}
