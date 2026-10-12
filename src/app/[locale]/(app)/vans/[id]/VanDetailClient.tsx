"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, ArrowUpFromLine, Bus, Check, ChevronRight, Package, ReceiptText, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { TransferPopup } from "../../inventory/transfers/[id]/TransferPopup";
import { packBreakdown } from "@/components/products/UnitQty";
import { mixedColisTotal } from "@/lib/products/colisage";
import { compareNatural } from "@/lib/sort";
import { dz } from "@/lib/format";
import { VanJournal } from "./VanJournal";
import { cn } from "@/lib/utils";

type Level = {
  productId: string;
  qty: number;
  product: {
    id: string;
    name: string;
    reference: string | null;
    minStock: number;
    baseUnit?: { name: string } | null;
    images?: Array<{ url: string }>;
    conversions?: Array<{ unitId: string; factor: number; unit: { name: string } }>;
  } | null;
};

type Transfer = {
  id: string;
  number: string;
  status: string;
  date: string;
  cashAmount: number;
  fromLocation: { id: string; name: string };
  toLocation: { id: string; name: string };
  lines: Array<{
    id: string;
    product: { id: string; name: string };
    declaredQty: number;
    confirmedQty: number | null;
  }>;
};

const STATUS_COLOR: Record<string, string> = {
  DECLARED: "pill-amber",
  CONFIRMED: "pill-emerald",
  REJECTED: "pill-red",
  CANCELLED: "bg-gray-500/10 text-gray-500",
};

const fmt = (v: number) => dz(v);

export function VanDetailClient({
  locale,
  van,
  levels,
  transfers,
  labels,
  embedded,
  onLoad,
  onUnload,
  value,
  currency,
}: {
  locale: string;
  van: { id: string; name: string; kind?: string | null; marque: string | null; matricule: string | null; imageUrl: string | null; user: { fullName: string } | null };
  levels: Level[];
  transfers: Transfer[];
  labels: Record<string, string>;
  /// Embedded in the fleet board: no page padding/breadcrumb; load/unload
  /// open the board popup instead of navigating when handlers are given.
  embedded?: boolean;
  onLoad?: (vanId: string) => void;
  onUnload?: (vanId: string) => void;
  /// Stock value (cost) for this van, when the caller computed it.
  value?: number;
  currency?: string;
}) {
  const [q, setQ] = useState("");
  const [zoom, setZoom] = useState<{ src: string; name: string } | null>(null);
  const [tab, setTab] = useState<"stock" | "journal">("stock");
  const router = useRouter();
  const [popupTransferId, setPopupTransferId] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      levels
        .filter((l) => !q || (l.product?.name ?? "").includes(q))
        .sort((a, b) => compareNatural(a.product?.name ?? "", b.product?.name ?? "", locale)),
    [levels, q, locale]
  );

  const totalUnits = useMemo(() => levels.reduce((s, l) => s + l.qty, 0), [levels]);
  const totalColis = useMemo(
    () =>
      mixedColisTotal(
        levels.map((l) => ({
          qty: l.qty,
          packsAsc: (l.product?.conversions ?? [])
            .filter((c) => Number(c.factor) > 1)
            .sort((a, b) => Number(a.factor) - Number(b.factor))
            .map((c) => ({ name: c.unit.name, factor: Number(c.factor) })),
        }))
      ),
    [levels]
  );
  const lowCount = useMemo(
    () => levels.filter((l) => l.product && l.qty <= l.product.minStock).length,
    [levels]
  );
  const inTransit = useMemo(() => transfers.filter((r) => r.status === "DECLARED"), [transfers]);
  const history = useMemo(() => transfers.filter((r) => r.status !== "DECLARED"), [transfers]);
  const inTransitQty = useMemo(
    () => inTransit.flatMap((r) => r.lines).reduce((s, l) => s + l.declaredQty, 0),
    [inTransit]
  );

  const statusLabel = (s: string) =>
    s === "DECLARED" ? labels.declared : s === "CONFIRMED" ? labels.confirmed : s === "REJECTED" ? labels.rejected : labels.cancelled;

  return (
    <div className={embedded ? "space-y-4" : "space-y-4 p-5 md:p-6"}>
      {!embedded && (
        <div className="flex items-center gap-2 text-xs opacity-60">
          <Link href={`/${locale}/vans`} className="flex items-center gap-1 font-bold hover:opacity-100">
            <ChevronRight size={14} className="rotate-180 rtl:rotate-0" />
            <Bus size={14} />
          </Link>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {van.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={van.imageUrl} alt={van.name} className="h-14 w-20 rounded-xl object-cover" />
        ) : (
          <div className="flex h-14 w-20 items-center justify-center rounded-xl bg-(--bg-sunken) text-(--text-secondary)">
            {van.kind === "DEPOT" ? <Warehouse size={24} /> : <Bus size={24} />}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold">
            {van.name}
            {van.kind === "DEPOT" && labels.depot && (
              <span className="ms-2 rounded-md bg-(--brand-500)/10 px-1.5 py-0.5 align-middle text-[11px] font-black text-(--brand-600)">
                {labels.depot}
              </span>
            )}
          </h1>
          {van.kind !== "DEPOT" && (
            <div className="truncate text-xs opacity-60">
              <span className="font-mono" dir="ltr">{van.matricule ?? ""}</span>
              {van.user ? ` · 👨‍✈️ ${van.user.fullName}` : ""}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {onLoad ? (
            <Button variant="secondary" onClick={() => onLoad(van.id)}>
              <ArrowDownToLine size={16} className="me-1" />
              {labels.load}
            </Button>
          ) : (
            <Link href={`/${locale}/inventory/transfers/new?to=${van.id}`}>
              <Button variant="secondary">
                <ArrowDownToLine size={16} className="me-1" />
                {labels.load}
              </Button>
            </Link>
          )}
          {onUnload ? (
            <Button onClick={() => onUnload(van.id)}>
              <ArrowUpFromLine size={16} className="me-1" />
              {labels.unload}
            </Button>
          ) : (
            <Link href={`/${locale}/inventory/transfers/new?from=${van.id}`}>
              <Button>
                <ArrowUpFromLine size={16} className="me-1" />
                {labels.unload}
              </Button>
            </Link>
          )}
        </div>
      </div>

      <div className={cn("grid gap-2", value != null ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-4")}>
        <div className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) px-3 py-2.5 text-center">
          <div className="text-lg font-black tabular-nums">{fmt(totalUnits)}</div>
          <div className="text-[11px] font-bold opacity-60">{van.kind === "DEPOT" ? (labels.inDepot ?? labels.onVan) : labels.onVan}</div>
        </div>
        {value != null && (
          <div className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) px-3 py-2.5 text-center">
            <div className="text-lg font-black tabular-nums" dir="ltr">{fmt(value)}{currency ? ` ${currency}` : ""}</div>
            <div className="text-[11px] font-bold opacity-60">{labels.value}</div>
          </div>
        )}
        <div className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) px-3 py-2.5 text-center">
          <div className="text-lg font-black tabular-nums">{levels.length}</div>
          <div className="text-[11px] font-bold opacity-60">{labels.levels}</div>
        </div>
        <div className={cn(
          "rounded-2xl border border-(--border-default) bg-(--bg-overlay) px-3 py-2.5 text-center",
          lowCount > 0 && "border-amber-500/50"
        )}>
          <div className={cn("text-lg font-black tabular-nums", lowCount > 0 && "text-amber-600")}>{lowCount}</div>
          <div className="text-[11px] font-bold opacity-60">{labels.lowStock}</div>
        </div>
      </div>

      {inTransit.length > 0 && (
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-black opacity-80">
            {labels.inTransit}
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-black text-amber-600">
              {fmt(inTransitQty)}
            </span>
          </h2>
          {inTransit.map((r) => {
            // Receipt belongs to the destination van: only it sees the
            // confirm button, which opens the receipt popup (lines +
            // adjustable quantities) instead of confirming blindly.
            const isReceiver = r.toLocation.id === van.id;
            return (
              <div
                key={r.id}
                className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-(--bg-overlay) p-3"
              >
                <button type="button" onClick={() => setPopupTransferId(r.id)} className="min-w-0 flex-1 text-start">
                  <div className="truncate text-sm font-bold">
                    {r.number} · {r.fromLocation.name} → {r.toLocation.name}
                  </div>
                  <div className="truncate text-xs opacity-60">
                    {r.lines.map((l) => `${l.product.name} (${fmt(l.declaredQty)})`).join(" · ")}
                  </div>
                </button>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-bold", STATUS_COLOR[r.status])}>
                  {statusLabel(r.status)}
                </span>
                {isReceiver && (
                  <button
                    type="button"
                    onClick={() => setPopupTransferId(r.id)}
                    className="flex shrink-0 items-center gap-1 rounded-xl bg-emerald-500/15 px-2.5 py-1.5 text-xs font-black text-emerald-600 transition-colors hover:bg-emerald-500/25"
                  >
                    <Check size={14} strokeWidth={3} />
                    {labels.confirm ?? ""}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex gap-2">
        {(["stock", "journal"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 rounded-xl px-3 py-2 text-sm font-black transition-colors",
              tab === t ? "bg-(--brand-500)/10 text-(--brand-600)" : "bg-(--bg-sunken) opacity-60 hover:opacity-100"
            )}
          >
            {t === "stock" ? labels.stockTab : labels.journal}
          </button>
        ))}
      </div>

      {tab === "journal" ? (
        <VanJournal
          vanId={van.id}
          labels={{
            stockIn: labels.stockIn,
            stockOut: labels.stockOut,
            noMovements: labels.noMovements,
            pending: labels.pending,
            offline: labels.offline,
          }}
        />
      ) : (
      <>
      <div className="flex gap-2">
        <div className="flex-1">
          <Input className="bg-white text-neutral-900 placeholder:text-neutral-400 focus:bg-white" placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {filtered.length === 0 && <p className="text-sm opacity-60">{labels.empty}</p>}
      <div className="space-y-2">
        {filtered.map((l) => {
          const low = !!l.product && l.qty <= l.product.minStock;
          return (
              <div
                key={l.productId}
                className={cn(
                  "flex items-center gap-3 rounded-xl border border-(--border-default) bg-(--bg-overlay) p-3",
                  low && "border-amber-500/50"
                )}
              >
                {l.product?.images?.[0] ? (
                  <button
                    type="button"
                    onClick={() => setZoom({ src: l.product?.images?.[0]?.url ?? "", name: l.product?.name ?? "" })}
                    aria-label={l.product?.name ?? ""}
                    className="shrink-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--brand-500)"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={l.product.images[0].url} alt={l.product?.name ?? ""} className="h-10 w-10 rounded-xl object-cover" loading="lazy" />
                  </button>
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--bg-sunken) text-(--text-secondary)">
                    <Package size={18} />
                  </div>
                )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{l.product?.name ?? l.productId}</div>
                <div className="truncate font-mono text-xs opacity-60" dir="ltr">{l.product?.reference ?? ""}</div>
              </div>
              {low && (
                <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-black text-amber-600">
                  {labels.lowStock}
                </span>
              )}
              <span className="shrink-0 text-end tabular-nums">
                <span className="block text-sm font-black">
                  {packBreakdown(
                    l.qty,
                    (l.product?.conversions ?? []).map((c) => ({ unitId: c.unitId, factor: Number(c.factor) })),
                    (id) => l.product?.conversions?.find((c) => c.unitId === id)?.unit.name ?? "",
                    l.product?.baseUnit?.name ?? ""
                  )}
                </span>
                <span className="block text-[11px] font-bold opacity-60">
                  = <bdi dir="ltr">{dz(l.qty)}</bdi> <bdi dir="auto">{l.product?.baseUnit?.name ?? ""}</bdi>
                </span>
              </span>
            </div>
          );
        })}
      </div>
      {filtered.length > 0 && (
        <div className="text-end text-sm font-black tabular-nums opacity-80">
          {labels.total}: {fmt(filtered.reduce((s, l) => s + l.qty, 0))}
          {totalColis.packs > 0 && totalColis.packName && (
            <span className="text-(--brand-600)"> · {totalColis.packs.toLocaleString()} {totalColis.packName}</span>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-black opacity-80">{labels.history} · {labels.transfers}</h2>
          {history.slice(0, 20).map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setPopupTransferId(r.id)}
              className="flex w-full items-center justify-between gap-2 rounded-xl border border-(--border-default) bg-(--bg-overlay) p-3 text-start opacity-80 transition-colors hover:border-(--brand-500) hover:opacity-100"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">
                  {r.number} · {r.fromLocation.name} → {r.toLocation.name}
                </div>
                <div className="truncate text-xs opacity-60">
                  {new Date(r.date).toLocaleDateString(locale)}
                  {r.cashAmount > 0 ? ` · 💵 ${fmt(r.cashAmount)}` : ""}
                </div>
              </div>
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-bold", STATUS_COLOR[r.status])}>
                {statusLabel(r.status)}
              </span>
            </button>
          ))}
        </div>
      )}
      </>
      )}

      <Modal
        open={popupTransferId !== null}
        onClose={() => setPopupTransferId(null)}
        title={labels.transfers ?? "transfers"}
        icon={<ReceiptText size={18} />}
        width="lg"
      >
        {popupTransferId && (
          <TransferPopup
            key={popupTransferId}
            transferId={popupTransferId}
            locale={locale}
            labels={labels}
            onDone={() => {
              setPopupTransferId(null);
              router.refresh();
            }}
          />
        )}
      </Modal>
      {zoom && <ImageLightbox src={zoom.src} alt={zoom.name} caption={zoom.name} onClose={() => setZoom(null)} />}
    </div>
  );
}
