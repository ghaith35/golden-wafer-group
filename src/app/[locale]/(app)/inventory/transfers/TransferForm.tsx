"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Check, ChevronLeft, ChevronRight, Search, Warehouse, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { UnitQty, PackInfo, factorOf, baseNameOf, packBreakdown } from "@/components/products/UnitQty";
import { ProductPicker } from "@/components/products/ProductPicker";
import { queueOp } from "@/lib/sync/client";
import { cn } from "@/lib/utils";

import { ErrText } from "@/components/ui/ErrText";
type Place = {
  id: string;
  name: string;
  kind: string;
  imageUrl?: string | null;
  matricule?: string | null;
  marque?: string | null;
  user?: { fullName: string; role?: string } | null;
};

function placeDriver(p: Place): string {
  return p.user?.fullName ?? "";
}

function PlaceThumb({ place, size = "md" }: { place: Pick<Place, "kind" | "imageUrl" | "name">; size?: "md" | "lg" }) {
  const cls = size === "lg" ? "h-11 w-16" : "h-10 w-14";
  if (place.imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={place.imageUrl} alt={place.name} className={`${cls} shrink-0 rounded-lg object-cover`} loading="lazy" />
    );
  }
  return (
    <span className={`${cls} flex shrink-0 items-center justify-center rounded-lg bg-(--bg-sunken)`}>
      <PlaceIcon kind={place.kind} />
    </span>
  );
}

function PlacePicker({
  value,
  onPick,
  places,
  excludeId,
  label,
  placeholder,
  stockById,
  stockKnown,
  disableEmpty,
  emptyLabel,
  kinds,
}: {
  value: string;
  onPick: (id: string) => void;
  places: Place[];
  excludeId?: string;
  label: string;
  placeholder: string;
  stockById?: Record<string, { units: number; skus: number }>;
  stockKnown?: boolean;
  disableEmpty?: boolean;
  emptyLabel?: string;
  kinds?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = places.find((p) => p.id === value);
  const needle = q.trim().toLowerCase();
  const isEmpty = (id: string) => !!disableEmpty && !!stockKnown && (stockById?.[id]?.skus ?? 0) === 0;
  const filtered = useMemo(
    () =>
      places
        .filter((p) => p.id !== excludeId)
        .filter((p) => !kinds || kinds.includes(p.kind))
        .filter(
          (p) =>
            !needle ||
            p.name.toLowerCase().includes(needle) ||
            (p.matricule ?? "").toLowerCase().includes(needle) ||
            (p.marque ?? "").toLowerCase().includes(needle) ||
            placeDriver(p).toLowerCase().includes(needle)
        )
        .slice(0, 80),
    [places, excludeId, kinds, needle]
  );
  const firstPickable = filtered.find((p) => !isEmpty(p.id));
  return (
    <div className={cn("min-w-0 flex-1 rounded-2xl border-2 p-3 transition-colors", value ? "border-(--brand-500)/50 bg-(--brand-500)/5" : "border-(--border-default)")}>
      <span className="mb-1.5 flex items-center gap-2">
        <PlaceIcon kind={selected?.kind ?? "DEPOT"} size={22} />
        <span className="text-[11px] font-bold uppercase opacity-60">{label}</span>
      </span>
      <div className="relative">
        <button
          type="button"
          onClick={() => { setQ(""); setOpen((o) => !o); }}
          className="flex w-full items-center gap-2 text-start outline-none"
        >
          {selected ? (
            <>
              <PlaceThumb place={selected} size="lg" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-black">{selected.name}</span>
                <span className="block truncate text-[11px] opacity-60" dir="auto">
                  {[selected.matricule, placeDriver(selected)].filter(Boolean).join(" · ") || selected.kind}
                  {stockKnown && stockById?.[selected.id] != null && (
                    <> · <bdi className="font-black tabular-nums">{stockById[selected.id].skus} · {stockById[selected.id].units.toLocaleString(undefined, { maximumFractionDigits: 0 })}</bdi></>
                  )}
                </span>
              </span>
            </>
          ) : (
            <span className="w-full truncate text-sm opacity-50">{placeholder}</span>
          )}
          {selected && (
            <span
              role="button"
              tabIndex={0}
              aria-label="clear"
              onClick={(e) => { e.stopPropagation(); onPick(""); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onPick(""); } }}
              className="shrink-0 rounded-full p-1 opacity-50 hover:bg-(--bg-sunken) hover:opacity-100"
            >
              <X size={14} />
            </span>
          )}
        </button>
        {open && (
          <>
            <button type="button" aria-label="close" onClick={() => setOpen(false)} className="fixed inset-0 z-10 cursor-default" />
            {/* Inline panel (in-flow, not absolute) so it is never clipped by
                the modal scroll container and the form grows taller. */}
            <div className="relative z-20 mt-2 overflow-hidden rounded-xl border border-(--border-default) bg-(--bg-overlay) shadow-xl">
              <div className="relative border-b border-(--border-subtle)">
                <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 opacity-50" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && firstPickable) {
                      onPick(firstPickable.id);
                      setOpen(false);
                    }
                    if (e.key === "Escape") setOpen(false);
                  }}
                  placeholder={placeholder}
                  className="h-11 w-full bg-transparent py-2 pe-3 ps-9 text-sm outline-none"
                />
              </div>
              <div className="max-h-80 overflow-y-auto p-1.5">
                {filtered.length === 0 && <p className="p-2 text-xs opacity-60">—</p>}
                {filtered.map((p) => {
                  const active = p.id === value;
                  const driver = placeDriver(p);
                  const empty = isEmpty(p.id);
                  const stock = stockById?.[p.id];
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={empty}
                      onClick={() => { onPick(p.id); setOpen(false); }}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg p-2 text-start transition-colors",
                        empty ? "cursor-not-allowed opacity-45" : "hover:bg-(--bg-sunken)",
                        active && "bg-(--brand-500)/10"
                      )}
                    >
                      <PlaceThumb place={p} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-bold">{p.name}</span>
                        <span className="block truncate text-[11px] opacity-60" dir="auto">
                          {[p.matricule, p.marque, driver].filter(Boolean).join(" · ") || p.kind}
                        </span>
                        {stockKnown && stock != null && (
                          <span className={cn("block text-[11px] font-black tabular-nums", stock.skus === 0 ? "text-red-500" : "text-(--brand-600)")}>
                            {stock.skus === 0 ? (emptyLabel ?? "Empty") : `${stock.skus} · ${stock.units.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                          </span>
                        )}
                      </span>
                      {active && <Check size={15} className="shrink-0 text-(--brand-600)" strokeWidth={3} />}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PlaceIcon({ kind, size = 18 }: { kind: string; size?: number }) {
  return kind === "VAN"
    ? <Truck size={size} className="shrink-0 text-(--brand-600)" />
    : <Warehouse size={size} className="shrink-0 text-(--brand-600)" />;
}

const STEPS = ["stepRoute", "stepLines", "stepReview"] as const;

/// A van driven by a Vendeur (مندوب) never holds stock: it must not be
/// offered as a source or destination, whatever screen opened the form.
const holdsStock = (p: Place) => !(p.kind === "VAN" && p.user?.role === "Vendeur");

export function TransferForm({
  locale,
  locations: allLocations,
  products,
  presetFrom,
  presetTo,
  labels,
  onSuccess,
  fromKinds,
  toKinds,
}: {
  locale: string;
  locations: Place[];
  products: Array<{
    id: string;
    name: string;
    stockQty: number;
    colisage?: string | null;
    barcode?: string | null;
    baseUnitId: string | null;
    baseUnit: { id: string; name: string } | null;
    saleUnitId: string | null;
    images: Array<{ url: string }>;
    conversions: Array<{ unitId: string; factor: number; barcode?: string | null; unit: { id: string; name: string } }>;
  }>;
  presetFrom: string;
  presetTo: string;
  labels: Record<string, string>;
  /// Embedded mode (board popup): on success refresh the parent instead of
  /// navigating to the detail page.
  onSuccess?: () => void;
  /// Restrict the "from" / "to" pickers to these location kinds
  /// (e.g. van-to-van: both ["VAN"]).
  fromKinds?: string[];
  toKinds?: string[];
}) {
  const locations = allLocations.filter(holdsStock);
  const router = useRouter();
  const [step, setStep] = useState(0);
  // A preset pointing at a van that cannot hold stock is dropped.
  const okId = (id: string) => (id && !allLocations.some((l) => l.id === id && !holdsStock(l)) ? id : "");
  const [from, setFrom] = useState(okId(presetFrom));
  const [to, setTo] = useState(okId(presetTo));
  const [cash, setCash] = useState(0);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Array<{ productId: string; unitId: string; qty: number }>>([{ productId: "", unitId: "", qty: 1 }]);
  const [avail, setAvail] = useState<Record<string, number>>({});
  /// True when avail comes from the last sync (offline): numbers may be stale.
  const [snapAvail, setSnapAvail] = useState(false);
  const [availLoaded, setAvailLoaded] = useState(!okId(presetFrom));
  const [stockByLoc, setStockByLoc] = useState<Record<string, { units: number; skus: number }>>({});
  const [stockKnown, setStockKnown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  /// Multi-select: tick several products at once instead of adding lines
  /// one by one (van loading). Each checked product becomes one line.
  const [multi, setMulti] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [mQuery, setMQuery] = useState("");

  // Available qty at the source location (server is authoritative).
  // Loaded on mount + whenever the source changes via pickFrom below.
  // Offline fallback: the synced snapshot (van stock or depot stock by kind).
  useEffect(() => {
    if (!from) return;
    let cancelled = false;
    fetch(`/api/inventory/levels?locationId=${from}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        const m: Record<string, number> = {};
        for (const l of d.levels as Array<{ productId: string; qty: number }>) m[l.productId] = Number(l.qty);
        setAvail(m);
        setAvailLoaded(true);
      })
      .catch(async () => {
        if (cancelled) return;
        try {
          const { getVanSnapshot, getVanId } = await import("@/lib/sync/client");
          const s = await getVanSnapshot();
          const fromKind = locations.find((l) => l.id === from)?.kind;
          // Snapshot only covers this device's van + depot aggregate: never
          // show another van's numbers as this source's (worse than empty).
          if (fromKind === "VAN" && from !== getVanId()) return;
          const rows = fromKind === "DEPOT" ? (s?.depotStock ?? []) : (s?.stock ?? []);
          const m: Record<string, number> = {};
          for (const r of rows) m[r.productId] = Number(r.qty ?? 0);
          if (!cancelled && Object.keys(m).length) {
            setAvail(m);
            setSnapAvail(true);
          }
        } catch {
          /* stay unloaded */
        } finally {
          if (!cancelled) setAvailLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from]);

  // Fleet-wide totals per location (one request) so empty places can be
  // flagged/disabled in the "from" picker without N requests.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/inventory/levels")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        const m: Record<string, { units: number; skus: number }> = {};
        for (const l of d.levels as Array<{ locationId: string; qty: number }>) {
          const e = m[l.locationId] ?? { units: 0, skus: 0 };
          e.units += Number(l.qty);
          e.skus += 1;
          m[l.locationId] = e;
        }
        setStockByLoc(m);
        setStockKnown(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function pickFrom(id: string) {
    setFrom(id);
    setAvail({});
    setSnapAvail(false);
    setAvailLoaded(!id);
    // Source changed → previously picked products may not exist there.
    setLines([{ productId: "", unitId: "", qty: 1 }]);
  }

  const valid = useMemo(() => lines.filter((l) => l.productId && l.qty > 0), [lines]);
  const fromLoc = locations.find((l) => l.id === from);
  const toLoc = locations.find((l) => l.id === to);
  const fromIsEmpty = !!from && stockKnown && (stockByLoc[from]?.skus ?? 0) === 0;
  // Only products physically present at the source can be transferred.
  const sourceProducts = useMemo(() => {
    if (!from) return products;
    if (!availLoaded) return [];
    return products.filter((p) => (avail[p.id] ?? 0) > 0);
  }, [from, availLoaded, products, avail]);
  const baseQtyOf = (l: { productId: string; unitId: string; qty: number }) => {
    const p = products.find((x) => x.id === l.productId);
    return l.qty * factorOf(p, l.unitId || p?.baseUnitId || "");
  };
  /// Stock label without the silly "1 000 قطعة (1 000 قطعة)" duplication:
  /// products with no pack units show the base qty once, others show the
  /// pack breakdown + the exact base total.
  const hasPackUnits = (p: { conversions: Array<{ factor: number }> } | undefined) =>
    !!p && p.conversions.some((c) => Number(c.factor) !== 1);
  const stockText = (
    p: { conversions: Array<{ unitId: string; factor: number; unit: { name: string } }>; baseUnit?: { name: string } | null } | undefined,
    q: number
  ) => {
    const base = p?.baseUnit?.name ?? "";
    if (!p || !hasPackUnits(p)) return `${q.toLocaleString(undefined, { maximumFractionDigits: 0 })}${base ? ` ${base}` : ""}`;
    const uname = (id: string) => p.conversions.find((c) => c.unitId === id)?.unit.name ?? "";
    return `${packBreakdown(q, p.conversions, uname, base)} (${q.toLocaleString(undefined, { maximumFractionDigits: 0 })}${base ? ` ${base}` : ""})`;
  };
  const totalUnits = valid.reduce((s, l) => s + baseQtyOf(l), 0);
  const overLine = valid.find((l) => (avail[l.productId] ?? Infinity) < baseQtyOf(l));

  /// Fill one line per product present at the source, each at its full
  /// available qty. Exact packs when it divides evenly (20 cartons),
  /// otherwise the exact base qty (22 pieces) — never a rounded fraction
  /// that would leave dust behind. The user can then adjust quantities,
  /// units or remove lines.
  function addAllFromSource() {    setError(null);
    setLines(
      sourceProducts.map((p) => {
        const saleId = p.saleUnitId ?? p.baseUnitId ?? "";
        const factor = factorOf(p, saleId) || 1;
        const raw = (avail[p.id] ?? 0) / factor;
        if (Number.isInteger(raw)) return { productId: p.id, unitId: saleId, qty: raw };
        return { productId: p.id, unitId: p.baseUnitId ?? saleId, qty: avail[p.id] ?? 0 };
      })
    );
  }

  /// Add one line (qty 1 in sale unit) per checked product, skipping
  /// products already on the document. The user adjusts quantities after.
  function addSelected() {
    setError(null);
    const have = new Set(lines.map((l) => l.productId).filter(Boolean));
    const fresh = checked.filter((id) => id && !have.has(id));
    if (!fresh.length) {
      setMulti(false);
      setChecked([]);
      return;
    }
    setLines((ls) => [
      ...ls,
      ...fresh.map((id) => {
        const p = products.find((x) => x.id === id);
        const saleId = (p as { saleUnitId?: string | null } | undefined)?.saleUnitId ?? p?.baseUnitId ?? "";
        return { productId: id, unitId: saleId, qty: 1 };
      }),
    ]);
    setChecked([]);
    setMulti(false);
  }

  function nextFromRoute() {
    setError(null);
    if (!from || !to || from === to) {
      setError("missing_fields");
      return;
    }
    if (fromIsEmpty) {
      setError(labels.emptySource ?? "empty_source");
      return;
    }
    setStep(1);
  }

  function nextFromLines() {
    setError(null);
    if (!valid.length) {
      setError("missing_fields");
      return;
    }
    if (overLine && from) {
      const p = products.find((x) => x.id === overLine.productId);
      setError(`insufficient_stock: ${p?.name ?? ""} (${avail[overLine.productId] ?? 0})`);
      return;
    }
    setStep(2);
  }

  async function submit() {
    setError(null);
    if (!from || !to || from === to || !valid.length) {
      setError("missing_fields");
      return;
    }
    if (overLine && from) {
      const p = products.find((x) => x.id === overLine.productId);
      setError(`insufficient_stock: ${p?.name ?? ""} (${avail[overLine.productId] ?? 0})`);
      return;
    }
    setBusy(true);
    try {
      const body = {
        fromLocationId: from,
        toLocationId: to,
        cashAmount: cash,
        notes: notes || null,
        lines: valid.map((l) => ({ productId: l.productId, qty: baseQtyOf(l) })),
      };
      let data;
      try {
        const res = await fetch("/api/transfers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "save_failed");
          return;
        }
      } catch {
        // Offline van: queue the declaration, it syncs when connected.
        try {
          await queueOp("transfer-declare", body as Record<string, unknown>);
        } catch {
          setError("save_failed");
          return;
        }
        setQueued(true);
        return;
      }
      if (onSuccess) {
        onSuccess();
        return;
      }
      router.push(`/${locale}/inventory/transfers/${data.id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[55vh] w-full max-w-4xl flex-col space-y-4 p-5 md:p-6">
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}
      {queued && <p className="rounded-lg bg-amber-500/10 p-2 text-sm font-bold text-amber-600">{labels.queued}</p>}

      {/* Stepper: each step owns its trailing connector so segments stay even */}
      <div className="flex items-center gap-1.5">
        {STEPS.map((s, i) => (
          <div key={s} className={cn("flex items-center gap-1.5", i < STEPS.length - 1 && "flex-1")}>
            <button
              type="button"
              onClick={() => i < step && setStep(i)}
              disabled={i >= step}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-2xl px-3 py-2 text-sm font-black transition-colors",
                i === step
                  ? "bg-gradient-brand text-(--brand-contrast) shadow-lg"
                  : i < step
                    ? "bg-(--brand-500)/10 text-(--brand-600)"
                    : "bg-(--bg-sunken) opacity-60"
              )}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/15 text-xs">
                {i < step ? <Check size={13} strokeWidth={3} /> : i + 1}
              </span>
              {labels[s]}
            </button>
            {i < STEPS.length - 1 && (
              <span className={cn("h-0.5 min-w-3 flex-1 rounded-full", i < step ? "bg-(--brand-500)" : "bg-(--border-default)")} />
            )}
          </div>
        ))}
      </div>

      {step === 0 && (
        <Card>
          {/* Route: searchable pickers with van images */}
          <div className="flex items-start gap-2">
            <PlacePicker
              value={from}
              onPick={pickFrom}
              places={locations}
              label={labels.from}
              placeholder={labels.search ?? labels.from}
              stockById={stockByLoc}
              stockKnown={stockKnown}
              disableEmpty
              emptyLabel={labels.emptyLocation ?? "Empty"}
              kinds={fromKinds}
            />
            <button
              type="button"
              onClick={() => { pickFrom(to); setTo(from); }}
              disabled={!from && !to}
              aria-label="swap"
              className="mt-12 flex w-11 shrink-0 items-center justify-center self-start rounded-2xl border border-(--border-default) bg-(--bg-sunken) p-2.5 hover:bg-(--border-subtle) disabled:opacity-40"
            >
              <ArrowLeftRight size={18} className="rtl:-scale-x-100" />
            </button>
            <PlacePicker
              value={to}
              onPick={setTo}
              places={locations}
              excludeId={from}
              label={labels.to}
              placeholder={labels.search ?? labels.to}
              stockById={stockByLoc}
              stockKnown={stockKnown}
              emptyLabel={labels.emptyLocation ?? "Empty"}
              kinds={toKinds}
            />
          </div>
          {from && stockKnown && (
            <div className={cn(
              "mt-2 rounded-xl px-3 py-2 text-xs font-black",
              fromIsEmpty ? "bg-red-500/10 text-red-500" : "bg-(--brand-500)/10 text-(--brand-600)"
            )}>
              {fromIsEmpty
                ? (labels.emptySource ?? "empty_source")
                : `${labels.sourceStock ?? "stock"} · ${fromLoc?.name ?? ""}: ${(stockByLoc[from]?.skus ?? 0)} · ${(stockByLoc[from]?.units ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            </div>
          )}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.cashAmount}</label>
              <Input type="number" min={0} step="any" value={cash} onChange={(e) => setCash(Number(e.target.value))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.notes}</label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <Button onClick={nextFromRoute} className="mt-4 h-12 w-full text-base">
            {labels.next}
          </Button>
        </Card>
      )}

      {step === 1 && (
        <>
          {from && (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-(--brand-500)/5 px-3 py-2 text-xs font-black">
              <span className="truncate opacity-80">
                {labels.onlyAvailable ?? ""} · {fromLoc?.name ?? ""}
                {snapAvail && <span className="opacity-60"> · ⏳</span>}
              </span>
              <span className="shrink-0 tabular-nums text-(--brand-600)">
                {availLoaded ? sourceProducts.length : "…"}
              </span>
            </div>
          )}
          {fromLoc?.kind === "VAN" && availLoaded && sourceProducts.length > 0 && (
            <Button type="button" variant="secondary" onClick={addAllFromSource} className="h-12 w-full text-sm font-black">
              📦 {labels.addAll ?? "addAll"} ({sourceProducts.length})
            </Button>
          )}
          {from && availLoaded && sourceProducts.length > 0 && !multi && (
            <Button type="button" variant="secondary" onClick={() => { setChecked([]); setMQuery(""); setMulti(true); }} className="h-12 w-full text-sm font-black">
              ☑️ {labels.multiSelect ?? "multi-select"}
            </Button>
          )}
          {multi && (
            <Card>
              <div className="relative mb-2">
                <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 opacity-50" />
                <input
                  value={mQuery}
                  onChange={(e) => setMQuery(e.target.value)}
                  placeholder={labels.search ?? ""}
                  className="h-11 w-full rounded-lg border border-(--border-default) bg-transparent py-2 pe-3 ps-9 text-sm outline-none"
                />
              </div>
              <div className="max-h-72 space-y-1 overflow-y-auto">
                {sourceProducts
                  .filter((p) => {
                    const nq = mQuery.trim().toLowerCase();
                    return !nq || p.name.toLowerCase().includes(nq) || (p.barcode ?? "").toLowerCase().includes(nq);
                  })
                  .map((p) => {
                    const on = checked.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setChecked((c) => (on ? c.filter((x) => x !== p.id) : [...c, p.id]))}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg p-2 text-start transition-colors",
                          on ? "bg-(--brand-500)/10" : "hover:bg-(--bg-sunken)"
                        )}
                      >
                        <span className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors",
                          on ? "border-(--brand-500) bg-(--brand-500) text-(--brand-contrast)" : "border-(--border-default)"
                        )}>
                          {on && <Check size={14} strokeWidth={3} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-bold">{p.name}</span>
                          <span className="block truncate text-[11px] tabular-nums opacity-60" dir="auto">
                            {fromLoc?.name ?? ""}: {stockText(p, avail[p.id] ?? 0)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
              </div>
              <div className="mt-2 flex gap-2">
                <Button type="button" variant="secondary" onClick={() => { setMulti(false); setChecked([]); }} className="flex-1">
                  {labels.back}
                </Button>
                <Button type="button" onClick={addSelected} disabled={checked.length === 0} className="flex-[2]">
                  {labels.addSelected ?? "add"} ({checked.length})
                </Button>
              </div>
            </Card>
          )}
          {from && !availLoaded ? (
            <Card>
              <p className="py-10 text-center text-sm opacity-60">{labels.loadingStock ?? "…"}</p>
            </Card>
          ) : from && sourceProducts.length === 0 ? (
            <Card>
              <p className="py-8 text-center text-sm font-black text-red-500">{labels.emptySource ?? "empty_source"}</p>
              <Button variant="secondary" onClick={() => setStep(0)} className="w-full">
                {labels.back}
              </Button>
            </Card>
          ) : (
          <div className="space-y-3">
          {lines.map((l, i) => {
            const p = products.find((x) => x.id === l.productId);
            const unitOpts = p
              ? [
                  ...(p.baseUnitId ? [{ id: p.baseUnitId, name: p.baseUnit?.name ?? "—" }] : []),
                  ...p.conversions.map((c) => ({ id: c.unitId, name: c.unit.name })),
                ]
              : [];
            const base = baseQtyOf(l);
            const av = p ? (avail[p.id] ?? 0) : 0;
            const pct = av > 0 ? Math.min(100, Math.round((base / av) * 100)) : base > 0 ? 100 : 0;
            const over = p && base > av;
            return (
              <Card key={i}>
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <ProductPicker
                      products={sourceProducts}
                      value={l.productId}
                      onPick={(np) => {
                        setLines((ls) => ls.map((x, j) => (j === i ? { ...x, productId: np.id, unitId: np.saleUnitId ?? np.baseUnitId ?? "" } : x)));
                      }}
                      placeholder={labels.product}
                      renderMeta={(x) => {
                        if (!from) return undefined;
                        const q = avail[x.id] ?? 0;
                        return (
                          <span className="flex min-w-0 items-center gap-1.5 text-[11px] opacity-60">
                            <bdi className="shrink-0 font-black tabular-nums text-(--brand-600)">
                              {fromLoc?.name ?? ""}: {stockText(x, q)}
                            </bdi>
                          </span>
                        );
                      }}
                    />
                    <PackInfo product={p} unitId={l.unitId} />
                  </div>
                  {unitOpts.length > 1 && (
                    <select
                      value={l.unitId}
                      onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unitId: e.target.value } : x)))}
                      className="h-11 w-24 shrink-0 rounded-lg border border-(--border-default) bg-(--bg-surface) px-1 text-xs font-bold outline-none"
                      aria-label={labels.unit}
                    >
                      {unitOpts.map((u) => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  )}
                  <Input
                    type="number" min={0} step="any" value={l.qty}
                    onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))}
                    className="w-24 shrink-0 font-black"
                  />
                  <Button type="button" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="shrink-0 px-2">✕</Button>
                </div>
                {p && from && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-[11px] font-bold">
                      <span className="opacity-60">
                        <bdi>{fromLoc?.name ?? ""}</bdi>: <bdi className="tabular-nums">{stockText(p, av)}</bdi>
                      </span>
                      <span className={cn("tabular-nums", over ? "text-red-500" : "text-(--brand-600)")}>
                        {base.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-(--bg-sunken)">
                      <div
                        className={cn("h-full rounded-full transition-all", over ? "bg-red-500" : pct > 80 ? "bg-amber-500" : "bg-emerald-500")}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <UnitQty qty={l.qty} factor={factorOf(p, l.unitId)} baseName={baseNameOf(p)} product={p} />
                  </div>
                )}
              </Card>
            );
          })}
          </div>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setLines((ls) => [...ls, { productId: "", unitId: "", qty: 1 }])} className="flex-1" disabled={!!from && (sourceProducts.length === 0 || !availLoaded)}>
              {labels.addLine}
            </Button>
          </div>
          {/* Sticky summary */}
          <div className="sticky bottom-3 rounded-2xl border border-(--border-default) bg-(--bg-overlay)/95 p-3 shadow-lg backdrop-blur">
            <div className="mb-2 flex items-center justify-between text-sm font-black tabular-nums">
              <span className="opacity-60">{valid.length} · {totalUnits.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              <span className="truncate text-[11px] font-bold opacity-60">
                {fromLoc?.name ?? ""} → {toLoc?.name ?? ""}
              </span>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setStep(0)} className="flex items-center gap-1">
                <ChevronRight size={15} className="rtl:rotate-180" />
                {labels.back}
              </Button>
              <Button onClick={nextFromLines} disabled={busy} className="flex flex-[2] items-center justify-center gap-1">
                {labels.next}
                <ChevronLeft size={15} className="rtl:rotate-180" />
              </Button>
            </div>
          </div>
        </>
      )}

      {step === 2 && (
        <Card>
          <div className="mb-3 flex items-center gap-2 rounded-xl bg-(--brand-500)/5 px-3 py-2.5 font-black">
            {fromLoc && <PlaceThumb place={fromLoc} />}
            <span className="truncate text-sm">{fromLoc?.name ?? "—"}</span>
            <ChevronLeft size={16} className="shrink-0 opacity-60 rtl:rotate-180" />
            {toLoc && <PlaceThumb place={toLoc} />}
            <span className="truncate text-sm">{toLoc?.name ?? "—"}</span>
          </div>
          <div className="max-h-[52vh] space-y-1.5 overflow-y-auto pe-0.5">
            {valid.map((l, i) => {
              const p = products.find((x) => x.id === l.productId);
              const uname = l.unitId === p?.baseUnitId
                ? (p?.baseUnit?.name ?? "")
                : (p?.conversions.find((c) => c.unitId === l.unitId)?.unit.name ?? "");
              const baseName = p?.baseUnit?.name ?? "";
              const sameUnit = !p || !hasPackUnits(p) || uname === baseName;
              return (
                <div key={i} className="flex items-center gap-2 rounded-xl bg-(--bg-sunken) px-3 py-2">
                  {p?.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.images[0].url} alt={p?.name ?? ""} className="h-9 w-9 shrink-0 rounded-lg object-cover" loading="lazy" />
                  ) : (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--bg-overlay)">📦</span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-bold">{p?.name ?? ""}</span>
                  <span className="shrink-0 text-sm font-black tabular-nums" dir="ltr">
                    {sameUnit
                      ? `${l.qty.toLocaleString()}${baseName ? ` ${baseName}` : ""}`
                      : `${l.qty.toLocaleString()} ${uname} = ${baseQtyOf(l).toLocaleString(undefined, { maximumFractionDigits: 0 })}${baseName ? ` ${baseName}` : ""}`}
                  </span>
                </div>
              );
            })}
          </div>
          {(cash > 0 || notes) && (
            <div className="mt-2 space-y-1 text-sm">
              {cash > 0 && <div><b>💵 {cash.toLocaleString()}</b></div>}
              {notes && <div className="opacity-70">{notes}</div>}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" onClick={() => setStep(1)} className="flex-1">
              {labels.back}
            </Button>
            <Button onClick={submit} disabled={busy} className="flex-[2]">
              {labels.save}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
