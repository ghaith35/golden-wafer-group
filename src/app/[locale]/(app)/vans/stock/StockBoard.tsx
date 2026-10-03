"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, ArrowUpFromLine, ArrowRightLeft, Bus, TriangleAlert, WifiOff, Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { BackButton } from "@/components/ui/BackButton";
import { KpiCard } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { VanDetailClient } from "../[id]/VanDetailClient";
import { TransferForm } from "../../inventory/transfers/TransferForm";
import { VanSheet } from "./VanSheet";
import { packBreakdown } from "@/components/products/UnitQty";
import { mixedColisTotal } from "@/lib/products/colisage";
import { cn } from "@/lib/utils";

type Van = {
  id: string;
  name: string;
  marque: string | null;
  matricule: string | null;
  imageUrl: string | null;
  user: { id: string; fullName: string; username: string } | null;
};

type Valuation = {
  storeId: string;
  qty: number;
  value: number;
  perProduct: Array<{ productId: string; qty: number; value: number }>;
};

const selectCls = "h-10 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-xs font-bold outline-none";

type Level = { productId: string; storeId: string; qty: number };

type BoardProduct = {
  id: string;
  name: string;
  reference: string | null;
  minStock: number;
  baseUnit: { name: string } | null;
  images: Array<{ url: string }>;
  conversions: Array<{ unitId: string; factor: number; unit: { name: string } }>;
};

type BoardTransfer = {
  id: string;
  number: string;
  status: string;
  date: string;
  cashAmount: number;
  fromLocationId: string;
  toLocationId: string;
  fromLocation: { id: string; name: string };
  toLocation: { id: string; name: string };
  lines: Array<{
    id: string;
    product: { id: string; name: string };
    declaredQty: number;
    confirmedQty: number | null;
  }>;
};

type BoardDevice = {
  locationId: string | null;
  label: string;
  lastSyncAt: string | null;
  _count: { ops: number };
};

function timeAgo(iso: string | null, locale: string): string {
  if (!iso) return "";
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return rtf.format(0, "minute");
  if (mins < 60) return rtf.format(-mins, "minute");
  const h = Math.floor(mins / 60);
  if (h < 24) return rtf.format(-h, "hour");
  return rtf.format(-Math.floor(h / 24), "day");
}

export function StockBoard({
  locale,
  vans,
  levels,
  products,
  transfers,
  devices,
  valuations,
  users,
  company,
  currency,
  labels,
  wizardLabels,
  detailLabels,
  sheetLabels,
}: {
  locale: string;
  vans: Van[];
  levels: Level[];
  products: BoardProduct[];
  transfers: BoardTransfer[];
  devices: BoardDevice[];
  valuations: Valuation[];
  users: Array<{ id: string; fullName: string }>;
  company: { name: string; phone?: string | null; address?: string | null; rc?: string | null; nif?: string | null; ai?: string | null; logoUrl?: string | null; signatureUrl?: string | null; stampUrl?: string | null };
  currency: string;
  labels: Record<string, string>;
  wizardLabels: Record<string, string>;
  detailLabels: Record<string, string>;
  sheetLabels: Record<string, string>;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"name" | "units" | "value" | "low">("name");
  const [driver, setDriver] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(vans[0]?.id ?? null);
  const [popup, setPopup] = useState<{ vanId: string; dir: "load" | "unload" | "van2van" } | null>(null);
  const [sheetVanId, setSheetVanId] = useState<string | null>(null);
  const [refs, setRefs] = useState<{
    locations: Array<{ id: string; name: string; kind: string; imageUrl?: string | null; matricule?: string | null; marque?: string | null; user?: { fullName: string } | null }>;
    products: Array<Record<string, unknown>>;
  } | null>(null);
  const [refsBusy, setRefsBusy] = useState(false);
  const byProduct = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const valueByVan = useMemo(() => new Map(valuations.map((e) => [e.storeId, e])), [valuations]);
  const needle = q.trim().toLowerCase();

  const fmtMoney = (v: number) =>
    `${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ""}`;

  const stats = useMemo(() => {
    const m = new Map<string, { units: number; skus: number; low: number; transit: number }>();
    for (const v of vans) {
      const lv = levels.filter((l) => l.storeId === v.id);
      m.set(v.id, {
        units: lv.reduce((s, l) => s + l.qty, 0),
        skus: lv.length,
        low: lv.filter((l) => {
          const p = byProduct.get(l.productId);
          return p && l.qty <= p.minStock;
        }).length,
        transit: transfers.filter((t) => t.status === "DECLARED" && (t.fromLocationId === v.id || t.toLocationId === v.id)).length,
      });
    }
    return m;
  }, [vans, levels, transfers, byProduct]);

  const filtered = useMemo(() => {
    const list = vans.filter(
      (v) =>
        (!needle || v.name.toLowerCase().includes(needle)) &&
        (!driver || (driver === "none" ? !v.user : v.user?.id === driver))
    );
    const valOf = (id: string) => valueByVan.get(id)?.value ?? 0;
    const unitsOf = (id: string) => stats.get(id)?.units ?? 0;
    const lowOf = (id: string) => stats.get(id)?.low ?? 0;
    const by: Record<typeof sort, (a: Van, b: Van) => number> = {
      name: (a, b) => a.name.localeCompare(b.name, locale),
      units: (a, b) => unitsOf(b.id) - unitsOf(a.id),
      value: (a, b) => valOf(b.id) - valOf(a.id),
      low: (a, b) => lowOf(b.id) - lowOf(a.id),
    };
    return [...list].sort(by[sort]);
  }, [vans, needle, driver, sort, stats, valueByVan, locale]);
  const selected = useMemo(
    () => filtered.find((v) => v.id === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId]
  );

  const detailLevels = useMemo(
    () =>
      selected
        ? levels
            .filter((l) => l.storeId === selected.id)
            .map((l) => {
              const p = byProduct.get(l.productId);
              return {
                productId: l.productId,
                qty: l.qty,
                product: p
                  ? { id: p.id, name: p.name, reference: p.reference, minStock: p.minStock, baseUnit: p.baseUnit, images: p.images, conversions: p.conversions }
                  : null,
              };
            })
        : [],
    [selected, levels, byProduct]
  );
  const detailTransfers = useMemo(
    () => (selected ? transfers.filter((t) => t.fromLocationId === selected.id || t.toLocationId === selected.id) : []),
    [selected, transfers]
  );

  const fleetUnits = [...stats.values()].reduce((s, x) => s + x.units, 0);
  const fleetLow = [...stats.values()].reduce((s, x) => s + x.low, 0);
  const fleetTransit = transfers.filter((t) => t.status === "DECLARED").length;
  const fleetColis = useMemo(
    () =>
      mixedColisTotal(
        levels.map((l) => {
          const p = byProduct.get(l.productId);
          return {
            qty: l.qty,
            packsAsc: (p?.conversions ?? [])
              .filter((c) => Number(c.factor) > 1)
              .sort((a, b) => Number(a.factor) - Number(b.factor))
              .map((c) => ({ name: c.unit.name, factor: Number(c.factor) })),
          };
        })
      ),
    [levels, byProduct]
  );
  const fleetUnitsLabel =
    fleetColis.packs > 0 && fleetColis.packName
      ? `${fleetUnits.toLocaleString(undefined, { maximumFractionDigits: 0 })} · ${fleetColis.packs.toLocaleString()} ${fleetColis.packName}`
      : fleetUnits.toLocaleString(undefined, { maximumFractionDigits: 0 });
  const fleetValue = [...valueByVan.values()].reduce((s, e) => s + e.value, 0);
  const selectedValue = selected ? (valueByVan.get(selected.id)?.value ?? 0) : 0;

  async function openPopup(vanId: string, dir: "load" | "unload" | "van2van") {
    setPopup({ vanId, dir });
    if (refs) return;
    setRefsBusy(true);
    try {
      const [locs, prods] = await Promise.all([
        fetch("/api/locations").then((r) => (r.ok ? r.json() : [])),
        fetch("/api/products").then((r) => (r.ok ? r.json() : [])),
      ]);
      setRefs({
        locations: locs as Array<{ id: string; name: string; kind: string; imageUrl?: string | null; matricule?: string | null; marque?: string | null; user?: { fullName: string } | null }>,
        products: (prods as Array<Record<string, unknown>>).map((p) => {
          const r = p as Record<string, unknown> & {
            stockQty: unknown; salePrice: unknown; costPrice: unknown;
            conversions: Array<{ factor: unknown }>; tierPrices: Array<{ price: unknown }>;
          };
          return {
            ...p,
            stockQty: Number(r.stockQty ?? 0),
            salePrice: Number(r.salePrice ?? 0),
            costPrice: Number(r.costPrice ?? 0),
            conversions: r.conversions.map((c) => ({ ...c, factor: Number(c.factor) })),
            tierPrices: r.tierPrices.map((x) => ({ ...x, price: Number(x.price) })),
          };
        }),
      });
    } finally {
      setRefsBusy(false);
    }
  }

  const popupVan = popup ? vans.find((v) => v.id === popup.vanId) : undefined;
  const mainDepotId = refs?.locations.find((l) => l.kind === "DEPOT")?.id ?? "";

  const sheetVan = sheetVanId ? (vans.find((v) => v.id === sheetVanId) ?? null) : null;
  const sheetRows = useMemo(() => {
    if (!sheetVan) return [];
    const vVals = new Map((valueByVan.get(sheetVan.id)?.perProduct ?? []).map((p) => [p.productId, p]));
    return levels
      .filter((l) => l.storeId === sheetVan.id)
      .map((l) => {
        const p = byProduct.get(l.productId);
        const uname = (id: string) => p?.conversions.find((c) => c.unitId === id)?.unit.name ?? "";
        const base = p?.baseUnit?.name ?? "";
        return {
          name: p?.name ?? l.productId,
          reference: p?.reference ?? "",
          colis: p ? packBreakdown(l.qty, p.conversions, uname, base) : String(l.qty),
          units: `${l.qty.toLocaleString(undefined, { maximumFractionDigits: 0 })}${base ? ` ${base}` : ""}`,
          value: vVals.get(l.productId)?.value ?? 0,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, locale));
  }, [sheetVan, levels, byProduct, valueByVan, locale]);
  const sheetTotals = useMemo(() => {
    const units = levels.filter((l) => sheetVan && l.storeId === sheetVan.id).reduce((s, l) => s + l.qty, 0);
    const value = sheetVan ? (valueByVan.get(sheetVan.id)?.value ?? 0) : 0;
    return { units, value };
  }, [levels, sheetVan, valueByVan]);

  return (
    <div className="flex flex-col gap-4 p-5 md:p-6 lg:h-[calc(100vh-2rem)] lg:overflow-hidden">

      <BackButton fallback={`/${locale}/vans`} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{labels.title}</h1>
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <KpiCard label={labels.onVan} value={fleetUnitsLabel} />
        <KpiCard label={labels.value} value={fmtMoney(fleetValue)} />
        <KpiCard label={labels.title} value={String(vans.length)} />
        <KpiCard label={labels.low} value={String(fleetLow)} />
        <KpiCard label={labels.inTransit} value={String(fleetTransit)} />
      </div>

      <div className="grid min-h-0 items-start gap-4 lg:flex-1 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* ── Sidebar: vans ── */}
        <div className="flex flex-col gap-2 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3 lg:h-full lg:min-h-0 lg:overflow-hidden">
          <Input placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold uppercase opacity-60">{labels.sortBy}</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={selectCls}>
                <option value="name">{labels.sortName}</option>
                <option value="units">{labels.sortUnits}</option>
                <option value="value">{labels.sortValue}</option>
                <option value="low">{labels.sortLow}</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold uppercase opacity-60">{labels.driver}</span>
              <select value={driver} onChange={(e) => setDriver(e.target.value)} className={selectCls}>
                <option value="">{labels.allDrivers}</option>
                <option value="none">{labels.noChauffeur}</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.fullName}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="max-h-[40vh] flex-1 space-y-1.5 overflow-y-auto lg:max-h-none lg:min-h-0">
            {filtered.length === 0 && <p className="py-6 text-center text-sm opacity-60">{labels.empty}</p>}
            {filtered.map((v) => {
              const s = stats.get(v.id) ?? { units: 0, skus: 0, low: 0, transit: 0 };
              const dev = devices.find((d) => d.locationId === v.id);
              const active = selected?.id === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelectedId(v.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-xl border p-2 text-start transition-colors",
                    active ? "border-(--brand-500) bg-(--brand-500)/5" : "border-(--border-default) hover:border-(--brand-500)"
                  )}
                >
                  {v.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={v.imageUrl} alt={v.name} className="h-11 w-16 shrink-0 rounded-lg object-cover" loading="lazy" />
                  ) : (
                    <span className="flex h-11 w-16 shrink-0 items-center justify-center rounded-lg bg-(--bg-sunken) text-(--text-secondary)">
                      <Bus size={20} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold">{v.name}</span>
                    <span className="block truncate text-[11px] opacity-60" dir="ltr">
                      {v.matricule ?? ""}{v.user ? ` · ${v.user.fullName}` : ""}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-black tabular-nums">
                      <span>{s.units.toLocaleString(undefined, { maximumFractionDigits: 0 })} {labels.onVan}</span>
                      <span className="text-(--brand-600)" dir="ltr">{fmtMoney(valueByVan.get(v.id)?.value ?? 0)}</span>
                      {s.low > 0 && (
                        <span className="flex items-center gap-0.5 text-amber-600">
                          <TriangleAlert size={11} />
                          {s.low} {labels.low}
                        </span>
                      )}
                      {s.transit > 0 && <span className="text-amber-600">· {labels.inTransit}</span>}
                      {(dev?._count.ops ?? 0) > 0 && <span className="text-red-500">· {dev!._count.ops}</span>}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-[10px] opacity-60">
                      {dev?.lastSyncAt ? (
                        <>{labels.lastSync}: <bdi className="font-black">{timeAgo(dev.lastSyncAt, locale)}</bdi></>
                      ) : (
                        <>
                          <WifiOff size={11} />
                          {labels.neverSynced}
                        </>
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Detail ── */}
        <div className="min-w-0 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-4 lg:h-full lg:min-h-0 lg:overflow-y-auto">
          {!selected ? (
            <p className="py-10 text-center text-sm opacity-60">{labels.empty}</p>
          ) : (
            <>
            <div className="mb-3 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void openPopup(selected.id, "van2van")} className="text-xs">
                <ArrowRightLeft size={15} className="me-1" />
                {labels.vanToVan}
              </Button>
              <Button variant="secondary" onClick={() => setSheetVanId(selected.id)} className="text-xs">
                <Printer size={15} className="me-1" />
                {labels.sheet}
              </Button>
            </div>
            <VanDetailClient
              key={selected.id}
              locale={locale}
              van={{
                id: selected.id,
                name: selected.name,
                marque: selected.marque,
                matricule: selected.matricule,
                imageUrl: selected.imageUrl,
                user: selected.user ? { fullName: selected.user.fullName } : null,
              }}
              levels={detailLevels}
              transfers={detailTransfers}
              labels={detailLabels}
              embedded
              onLoad={(id) => void openPopup(id, "load")}
              onUnload={(id) => void openPopup(id, "unload")}
              value={selectedValue}
              currency={currency}
            />
            </>
          )}
        </div>
      </div>

      <Modal
        open={popup !== null}
        onClose={() => setPopup(null)}
        title={popup ? `${popup.dir === "load" ? labels.load : popup.dir === "unload" ? labels.unload : labels.vanToVan} · ${popupVan?.name ?? ""}` : ""}
        icon={popup?.dir === "load" ? <ArrowDownToLine size={18} /> : popup?.dir === "unload" ? <ArrowUpFromLine size={18} /> : <ArrowRightLeft size={18} />}
        width="2xl"
      >
        {popup && refs && (
          <TransferForm
            key={`${popup.vanId}-${popup.dir}`}
            locale={locale}
            locations={refs.locations}
            products={refs.products as never}
            presetFrom={popup.dir === "load" ? mainDepotId : popup.vanId}
            presetTo={popup.dir === "load" ? popup.vanId : ""}
            fromKinds={popup.dir === "load" ? ["DEPOT"] : ["VAN"]}
            toKinds={popup.dir === "unload" ? undefined : ["VAN"]}
            labels={wizardLabels}
            onSuccess={() => {
              setPopup(null);
              router.refresh();
            }}
          />
        )}
        {popup && !refs && (
          <p className="py-10 text-center text-sm opacity-60">{refsBusy ? "…" : ""}</p>
        )}
      </Modal>

      <Modal
        open={sheetVanId !== null}
        onClose={() => setSheetVanId(null)}
        title={labels.sheet}
        icon={<Printer size={18} />}
        width="2xl"
      >
        {sheetVan && (
          <VanSheet
            van={sheetVan}
            driverName={sheetVan.user?.fullName ?? labels.noChauffeur}
            company={company}
            currency={currency}
            date={new Date().toLocaleDateString(locale)}
            rows={sheetRows}
            totals={sheetTotals}
            labels={sheetLabels}
          />
        )}
      </Modal>
    </div>
  );
}
