import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import QRCode from "qrcode";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { clientQrPayload } from "@/lib/clients/validation";
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

  const [sales, returns, versements, deposits] = await Promise.all([
    prisma.sale.findMany({
      where: { clientId: client.id, kind: { in: ["DELIVERY", "TICKET"] }, status: "DELIVERED" },
      select: { id: true, number: true, date: true, total: true, paid: true },
      orderBy: { date: "desc" },
      take: 30,
    }),
    prisma.clientReturn.findMany({
      where: { clientId: client.id },
      select: { id: true, number: true, date: true, total: true, refundType: true },
      orderBy: { date: "desc" },
      take: 30,
    }),
    prisma.versement.findMany({
      where: { clientId: client.id, kind: "CLIENT_PAYMENT" },
      select: { id: true, date: true, amount: true },
      orderBy: { date: "desc" },
      take: 30,
    }),
    prisma.deposit.findMany({
      where: { clientId: client.id },
      select: { id: true, date: true, amount: true },
      orderBy: { date: "desc" },
      take: 30,
    }),
  ]);

  const qr = await QRCode.toDataURL(clientQrPayload(session.companyId, client.code), { margin: 1, width: 256 });
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
    <div className="mx-auto max-w-2xl space-y-4 p-5 md:p-6">
      <BackButton fallback={`/${locale}/clients`} />
      <h1 className="text-xl font-bold">
        {client.name} <span className="font-mono text-sm opacity-50">{client.code}</span>
      </h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <div className="mb-2 text-sm font-bold">{t("qr")}</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt={client.code} className="mx-auto h-40 w-40" />
          <div className="mt-1 text-center font-mono text-xs opacity-60">{client.code}</div>
        </Card>
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
      </div>
      <Card>
        <h2 className="mb-2 text-sm font-bold">📒 {t("statement")}</h2>
        {sales.map((s) => (
          <div key={s.id} className="flex justify-between border-b border-(--border-subtle) py-1.5 text-sm last:border-0">
            <span>🧾 {s.number} · {new Date(s.date).toLocaleDateString(locale)}</span>
            <span className="font-bold">+{String(s.total)} <span className="opacity-50">({t("paid")}: {String(s.paid)})</span></span>
          </div>
        ))}
        {returns.map((r) => (
          <div key={r.id} className="flex justify-between border-b border-(--border-subtle) py-1.5 text-sm last:border-0">
            <span>↩️ {r.number} · {new Date(r.date).toLocaleDateString(locale)}</span>
            <span className="font-bold text-emerald-600">−{String(r.total)}</span>
          </div>
        ))}
        {versements.map((v) => (
          <div key={v.id} className="flex justify-between border-b border-(--border-subtle) py-1.5 text-sm last:border-0">
            <span>💵 {new Date(v.date).toLocaleDateString(locale)}</span>
            <span className="font-bold text-emerald-600">−{String(v.amount)}</span>
          </div>
        ))}
        {deposits.map((x) => (
          <div key={x.id} className="flex justify-between border-b border-(--border-subtle) py-1.5 text-sm last:border-0">
            <span>📥 {new Date(x.date).toLocaleDateString(locale)}</span>
            <span className="font-bold text-emerald-600">−{String(x.amount)}</span>
          </div>
        ))}
      </Card>
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
