import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/Card";
import { BackButton } from "@/components/ui/BackButton";
import { TourneeDay } from "./TourneeDay";
import { TourneeMapSection } from "./TourneeMapSection";

export default async function TourneeDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("tournees");
  const row = await prisma.tournee.findFirst({
    where: { id, companyId: session.companyId },
    include: {
      location: true,
      secteur: true,
      stops: { include: { client: true }, orderBy: { position: "asc" } },
      sales: { include: { client: { select: { name: true } } } },
    },
  });
  if (!row) notFound();

  // Link tournee sales to stops (mark sold + totals) — best effort read model.
  const soldByClient = new Map(row.sales.map((s) => [s.clientId, s]));

  // What the van is carrying right now (server-safe breakdown).
  const load = await prisma.stockBatch.groupBy({
    by: ["productId"],
    where: { companyId: session.companyId, storeId: row.locationId, transferId: null, qty: { gt: 0 } },
    _sum: { qty: true },
  });
  const loadProducts = load.length
    ? await prisma.product.findMany({
        where: { id: { in: load.map((l) => l.productId) } },
        select: {
          id: true, name: true,
          baseUnit: { select: { name: true } },
          conversions: { select: { unitId: true, factor: true, unit: { select: { name: true } } } },
        },
      })
    : [];
  const loadById = new Map(loadProducts.map((p) => [p.id, p]));
  const loadTotal = load.reduce((s, l) => s + Number(l._sum.qty ?? 0), 0);
  const breakdown = (productId: string, qty: number): string => {
    const p = loadById.get(productId);
    const base = p?.baseUnit?.name ?? "";
    const packs = (p?.conversions ?? []).filter((c) => Number(c.factor) > 1).sort((a, b) => Number(b.factor) - Number(a.factor));
    if (!packs.length) return `${qty.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${base}`.trim();
    let rest = Math.round(qty * 1000) / 1000;
    const parts: string[] = [];
    for (const pack of packs) {
      const f = Number(pack.factor);
      const n = Math.floor(rest / f + 1e-9);
      if (n > 0) {
        parts.push(`${n.toLocaleString()} ${pack.unit.name}`);
        rest = Math.round((rest - n * f) * 1000) / 1000;
      }
    }
    if (rest > 0 || !parts.length) parts.push(`${rest.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${base}`.trim());
    return parts.join(" + ");
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-5 md:p-6 lg:max-w-4xl xl:max-w-5xl">
      <BackButton fallback={`/${locale}/tournees`} />
      <h1 className="text-xl font-bold">
        {new Date(row.date).toLocaleDateString(locale)} · {row.location.name} {row.secteur ? `· ${row.secteur.name}` : ""}
      </h1>
      <Card>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm font-black">{t("onVan")} · {loadTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          <Link href={`/${locale}/vans/${row.locationId}`} className="rounded-lg bg-(--bg-sunken) px-2 py-1 text-[11px] font-black hover:bg-(--border-subtle)">
            {row.location.name}
          </Link>
        </div>
        {load.length === 0 ? (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-600">
            <span>{t("emptyVan")}</span>
            <Link href={`/${locale}/inventory/transfers/new?to=${row.locationId}`} className="shrink-0 rounded-lg bg-amber-500/20 px-2 py-1 font-black">
              {t("load")}
            </Link>
          </div>
        ) : (
          <div className="space-y-1">
            {[...load].sort((a, b) => Number(b._sum.qty ?? 0) - Number(a._sum.qty ?? 0)).slice(0, 8).map((l) => (
              <div key={l.productId} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-bold">{loadById.get(l.productId)?.name ?? ""}</span>
                <span className="shrink-0 font-black tabular-nums text-(--brand-600)">{breakdown(l.productId, Number(l._sum.qty ?? 0))}</span>
              </div>
            ))}
            {load.length > 8 && (
              <Link href={`/${locale}/vans/${row.locationId}`} className="block text-center text-[11px] font-bold opacity-60">
                +{load.length - 8} · {row.location.name}
              </Link>
            )}
          </div>
        )}
      </Card>
      <TourneeMapSection
        stops={row.stops.map((s) => ({
          id: s.id,
          name: s.client.name,
          code: s.client.code,
          lat: s.client.gpsLat,
          lng: s.client.gpsLng,
          position: s.position,
          state: s.sold ? "sold" : s.visited ? "visited" : s.skipped ? "skipped" : "pending",
        }))}
      />
      <TourneeDay
        locale={locale}
        tourneeId={row.id}
        locationId={row.locationId}
        isOpen={row.status === "OPEN"}
        stops={JSON.parse(JSON.stringify(row.stops)).map((s: Record<string, unknown>) => {
          const linked = soldByClient.get(s.clientId as string);
          return { ...s, total: Number(s.total), sold: (s.sold as boolean) || !!linked };
        })}
        sales={JSON.parse(JSON.stringify(row.sales))}
        labels={{
          stops: t("stops"), locate: t("locate"), geoDenied: t("geoDenied"),
          unitM: t("unitM"), unitKm: t("unitKm"), unitMin: t("unitMin"),
        }}
      />
    </div>
  );
}
