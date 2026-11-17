"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Minus, Package, Plus, ReceiptText, Search, ShoppingCart, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { UnitQty, factorOf, baseNameOf, packBreakdown, priceForUnit, saleUnits, normFactor } from "@/components/products/UnitQty";
import { ProductCardDetails } from "@/components/products/ProductCardDetails";
import { cn } from "@/lib/utils";

import { ErrText } from "@/components/ui/ErrText";
type Product = {
  id: string;
  name: string;
  reference: string | null;
  barcode: string | null;
  salePrice: number;
  stockQty: number;
  colisage?: string | null;
  baseUnitId: string | null;
  baseUnit: { id: string; name: string } | null;
  saleUnitId: string | null;
  conversions: Array<{ unitId: string; factor: number; barcode?: string | null; unit: { id: string; name: string } }>;
  tierPrices: Array<{ tierId: string; price: number }>;
  images: Array<{ url: string }>;
  category: { id: string; name: string } | null;
};

type Client = { id: string; name: string; code: string; tierId: string | null; balance: number };
type Line = { productId: string; unitId: string; qty: number; unitPrice: string; remise: number };

const inputCls = "h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-3 text-sm outline-none focus:border-(--brand-500)";

const fmt = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

export function PosClient({
  locale,
  depots,
  presetDepotId,
  products,
  categories,
  clients,
  tiers,
  remiseEnabled,
  creditEnabled,
  allowPieces = false,
  labels,
}: {
  locale: string;
  depots: Array<{ id: string; name: string; kind: string }>;
  presetDepotId: string;
  products: Product[];
  categories: Array<{ id: string; name: string }>;
  clients: Client[];
  tiers: Array<{ id: string; name: string }>;
  remiseEnabled: boolean;
  creditEnabled: boolean;
  allowPieces?: boolean;
  labels: Record<string, string>;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientQ, setClientQ] = useState("");
  const [tierId, setTierId] = useState("");
  const [locationId, setLocationId] = useState(presetDepotId);
  /// Live availability at the selected selling location (server truth —
  /// falls back to the product's global stock while loading).
  const [locQty, setLocQty] = useState<Record<string, number> | null>(null);
  const locReq = useRef(0);

  async function loadLocQty(id: string) {
    if (!id) {
      setLocQty(null);
      return;
    }
    const req = ++locReq.current;
    try {
      const r = await fetch(`/api/inventory/levels?locationId=${id}`);
      const d = r.ok ? await r.json() : null;
      if (!d || locReq.current !== req) return;
      const m: Record<string, number> = {};
      for (const l of d.levels as Array<{ productId: string; qty: number }>) m[l.productId] = Number(l.qty);
      setLocQty(m);
    } catch {
      /* keep previous snapshot */
    }
  }

  function pickLocation(id: string) {
    setLocationId(id);
    setLocQty(null);
    if (id) void loadLocQty(id);
  }

  useEffect(() => {
    if (!presetDepotId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/inventory/levels?locationId=${presetDepotId}`);
        const d = r.ok ? await r.json() : null;
        if (!d || cancelled) return;
        const m: Record<string, number> = {};
        for (const l of d.levels as Array<{ productId: string; qty: number }>) m[l.productId] = Number(l.qty);
        setLocQty(m);
      } catch {
        /* keep global fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [presetDepotId]);
  const [lines, setLines] = useState<Line[]>([]);
  const [docRemise, setDocRemise] = useState(0);
  const [paid, setPaid] = useState("");
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; total: number; paid: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    searchRef.current?.focus();
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const tierName = (id: string) => tiers.find((x) => x.id === id)?.name ?? id;
  const saleUnitName = (p: Product) => {
    const id = p.saleUnitId ?? p.baseUnitId ?? "";
    if (id === p.baseUnitId) return p.baseUnit?.name ?? "";
    return p.conversions.find((c) => c.unitId === id)?.unit.name ?? "";
  };
  const client = clients.find((c) => c.id === clientId);
  const effTier = tierId || client?.tierId || "";

  function priceFor(p: Product, unitId = ""): number {
    const base = (() => {
      if (effTier) {
        const tp = p.tierPrices.find((x) => x.tierId === effTier);
        if (tp) return tp.price;
      }
      return p.salePrice;
    })();
    return priceForUnit(base, factorOf(p, unitId));
  }

  function addProduct(id: string, unitId?: string) {
    const p = byId.get(id);
    if (!p) return;
    const opts = saleUnits(p, allowPieces);
    const def = p.saleUnitId && opts.some((u) => u.id === p.saleUnitId)
      ? p.saleUnitId
      : (opts[0]?.id ?? p.baseUnitId ?? "");
    const unit = unitId && (allowPieces || opts.some((u) => u.id === unitId)) ? unitId : def;
    setLines((ls) => {
      const i = ls.findIndex((l) => l.productId === id && l.unitId === unit && l.unitPrice === "" && l.remise === 0);
      if (i >= 0) {
        const next = [...ls];
        next[i] = { ...next[i], qty: next[i].qty + 1 };
        return next;
      }
      return [...ls, { productId: id, unitId: unit, qty: 1, unitPrice: "", remise: 0 }];
    });
    setJustAdded(id);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setJustAdded(null), 700);
  }

  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }
  function bump(i: number, d: number) {
    setLines((ls) =>
      ls.map((l, j) => (j === i ? { ...l, qty: Math.max(0, l.qty + d) } : l)).filter((l) => l.qty > 0)
    );
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products.filter((p) => {
      if (cat && p.category?.id !== cat) return false;
      if (!needle) return true;
      return (
        p.name.toLowerCase().includes(needle) ||
        (p.barcode ?? "").toLowerCase().includes(needle) ||
        (p.reference ?? "").toLowerCase().includes(needle) ||
        p.conversions.some((c) => (c.barcode ?? "").toLowerCase() === needle)
      );
    }).slice(0, 120);
  }, [products, q, cat]);

  /// Exact pack-barcode scan → product + its pack unit (scanner sends Enter).
  function packScanMatch(code: string): { id: string; unitId: string } | null {
    const needle = code.trim().toLowerCase();
    if (!needle) return null;
    for (const p of products) {
      if ((p.barcode ?? "").toLowerCase() === needle) {
        return { id: p.id, unitId: p.saleUnitId ?? p.baseUnitId ?? "" };
      }
      const conv = p.conversions.find((c) => (c.barcode ?? "").toLowerCase() === needle);
      if (conv) return { id: p.id, unitId: conv.unitId };
    }
    return null;
  }

  const shownClients = useMemo(() => {
    const needle = clientQ.trim();
    if (!needle) return clients.slice(0, 30);
    return clients.filter((c) => c.name.includes(needle) || c.code.includes(needle)).slice(0, 30);
  }, [clients, clientQ]);

  const totals = useMemo(() => {
    const linesTotal = lines.reduce((s, l) => {
      const p = byId.get(l.productId);
      const price = l.unitPrice === "" ? (p ? priceFor(p, l.unitId) : 0) : Number(l.unitPrice);
      return s + Math.max(0, l.qty * price - l.remise);
    }, 0);
    return { linesTotal, total: Math.max(0, linesTotal - docRemise) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, docRemise, effTier, byId]);

  const paidNum = paid === "" ? totals.total : Number(paid);
  const diff = paidNum - totals.total;
  const count = lines.reduce((s, l) => s + l.qty, 0);

  function reset() {
    setLines([]);
    setDocRemise(0);
    setPaid("");
    setClientId("");
    setClientQ("");
    setDone(null);
    setError(null);
    searchRef.current?.focus();
  }

  async function submit() {
    setError(null);
    const valid = lines.filter((l) => l.productId && l.qty > 0);
    if (!valid.length) {
      setError("lines_required");
      return;
    }
    if (!locationId) {
      setError("location_required");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/sales/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: clientId || null,
          locationId,
          tierId: effTier || null,
          channel: "POS",
          qrScanned: false,
          tourneeId: null,
          remise: docRemise,
          paid: paidNum,
          notes: null,
          lines: valid.map((l) => ({
            productId: l.productId,
            unitId: l.unitId || null,
            qty: l.qty,
            unitPrice: l.unitPrice === "" ? null : Number(l.unitPrice),
            remise: l.remise,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "save_failed");
        return;
      }
      setDone({ id: data.id, total: totals.total, paid: paidNum });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 p-5 md:p-6">
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}

      <div className="grid items-start gap-4 lg:h-[calc(100dvh-190px)] lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* ── Product shelf (start side) ── */}
        <div className="min-w-0 space-y-3 lg:h-full lg:overflow-y-auto lg:pe-1">
          <div className="flex gap-2">
            <select
              value={locationId}
              onChange={(e) => pickLocation(e.target.value)}
              className="h-12 shrink-0 rounded-xl border border-(--border-default) bg-(--bg-surface) px-2 text-sm font-bold"
              aria-label={labels.depot}
            >
              <option value="">— {labels.depot}</option>
              {depots.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          <div className="relative min-w-0 flex-1">
            <Search size={17} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 opacity-50" />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const scan = packScanMatch(q);
                  if (scan) {
                    addProduct(scan.id, scan.unitId);
                  } else if (filtered.length > 0) {
                    addProduct(filtered[0].id);
                  } else {
                    return;
                  }
                  setQ("");
                }
              }}
              placeholder={labels.search}
              className="h-12 w-full rounded-xl border border-(--border-default) bg-white py-2 pe-4 ps-10 text-sm font-semibold text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-(--brand-500) focus:bg-white"
            />
            {q && (
              <button
                onClick={() => setQ("")}
                className="absolute end-3 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100"
                aria-label="clear"
              >
                <X size={16} />
              </button>
            )}
          </div>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => setCat("")}
              className={cn(
                "min-h-11 shrink-0 items-center rounded-full px-4 py-1.5 text-xs font-black transition-colors",
                cat === "" ? "bg-(--brand-500) text-(--brand-contrast) shadow" : "bg-(--bg-sunken) opacity-70 hover:opacity-100"
              )}
            >
              {labels.all}
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setCat(cat === c.id ? "" : c.id)}
                className={cn(
                  "min-h-11 shrink-0 items-center rounded-full px-4 py-1.5 text-xs font-black transition-colors",
                  cat === c.id ? "bg-(--brand-500) text-(--brand-contrast) shadow" : "bg-(--bg-sunken) opacity-70 hover:opacity-100"
                )}
              >
                {c.name}
              </button>
            ))}
          </div>

          {filtered.length === 0 && <p className="py-10 text-center text-sm opacity-60">{labels.empty}</p>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {filtered.map((p) => {
              const img = p.images[0]?.url;
              const added = justAdded === p.id;
              // Availability follows the selected location; global while loading.
              const availQty = !locationId ? p.stockQty : locQty ? (locQty[p.id] ?? 0) : p.stockQty;
              const out = availQty <= 0;
              const shelfPrice = priceFor(p, p.saleUnitId ?? p.baseUnitId ?? "");
              const saleFactor = factorOf(p, p.saleUnitId ?? p.baseUnitId ?? "") || 1;
              const pieceConv = p.conversions.filter((c) => c.factor < 1).sort((a, b) => a.factor - b.factor)[0];
              const pieceN = pieceConv ? Math.round(1 / normFactor(pieceConv.factor)) : 0;
              return (
                <button
                  key={p.id}
                  onClick={() => addProduct(p.id)}
                  className={cn(
                    "group relative flex flex-col overflow-hidden rounded-2xl border border-(--border-default) bg-(--bg-overlay) text-start  transition-all hover:-translate-y-0.5 hover:border-(--brand-500) hover:shadow-md",
                    out && "opacity-70 saturate-50"
                  )}
                >
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img} alt={p.name} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex aspect-[4/3] w-full items-center justify-center bg-(--bg-sunken) text-(--text-secondary)">
                      <Package size={34} strokeWidth={1.5} />
                    </div>
                  )}
                  <div className="flex flex-1 flex-col gap-0.5 p-2.5">
                    <div className="truncate text-[13px] font-bold leading-5">{p.name}</div>
                    <div className="flex items-center justify-between text-[11px] opacity-60">
                      <span className="truncate font-mono" dir="ltr">{p.reference ?? p.barcode ?? ""}</span>
                      <span className={cn("shrink-0 font-bold", out ? "text-red-500" : availQty <= 3 ? "text-amber-600" : "")}>
                        {fmt(availQty)}
                      </span>
                    </div>
                    {p.conversions.length > 0 && (
                      <div className="truncate text-[11px] font-bold text-(--brand-600)">
                        {packBreakdown(
                          availQty,
                          p.conversions,
                          (id) => p.conversions.find((c) => c.unitId === id)?.unit.name ?? "",
                          p.baseUnit?.name ?? "—"
                        )}
                      </div>
                    )}
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-sm font-black tabular-nums">
                        <span dir="ltr" className="block">
                          {fmt(shelfPrice)} {labels.currency} / {saleUnitName(p)}
                        </span>
                        {pieceConv && (
                          <span dir="ltr" className="flex items-center gap-1 text-start text-[11px] font-bold text-(--brand-600)">
                            <span>{fmt(shelfPrice / pieceN)} {labels.currency} / {pieceConv.unit.name}</span>
                            <span>=</span>
                          </span>
                        )}
                        {!pieceConv && saleFactor !== 1 && (
                          <span dir="ltr" className="block text-start text-[11px] font-bold text-(--brand-600)">
                            {fmt(shelfPrice / saleFactor)} {labels.currency} / {p.baseUnit?.name ?? ""}
                          </span>
                        )}
                      </span>
                      <span
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                          added ? "bg-emerald-500 text-white" : "bg-(--brand-500) text-(--brand-contrast) group-hover:scale-110"
                        )}
                      >
                        {added ? <Check size={16} strokeWidth={3} /> : <Plus size={16} strokeWidth={3} />}
                      </span>
                    </div>
                    {(p.tierPrices.length > 0 || p.conversions.length > 0) && (
                      <div className="mt-1 border-t border-(--border-subtle) pt-1">
                        <ProductCardDetails
                          stockQty={0}
                          costPrice={0}
                          salePrice={priceFor(p, p.baseUnitId ?? "")}
                          tiers={p.tierPrices.map((x) => ({ name: tierName(x.tierId), price: x.price }))}
                          conversions={p.conversions.map((c) => ({ unitId: c.unitId, factor: c.factor, unitName: c.unit.name }))}
                          baseName={p.baseUnit?.name ?? ""}
                          costLabel=""
                          saleLabel=""
                          cumpLabel=""
                          valueLabel=""
                          marginLabel=""
                          compact
                          showBase={false}
                          showStock={false}
                        />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Cart (end side) ── */}
        <div className="flex rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-4  lg:h-full lg:min-h-0 lg:flex-col lg:overflow-hidden">
          <div className="mb-3 flex min-h-12 items-center justify-between rounded-xl bg-(--bg-sunken) px-3 py-2">
            <span className="flex items-center gap-2 text-base font-black">
              <ReceiptText size={19} className="text-(--brand-600)" />
              {labels.total}
              <span className="rounded-full bg-(--brand-500) px-2.5 py-1 text-xs font-black text-(--brand-contrast)">{count}</span>
            </span>
            {lines.length > 0 && (
              <button onClick={() => setLines([])} className="text-xs font-bold text-red-500 opacity-70 hover:opacity-100">
                <Trash2 size={14} className="inline me-1" />
              </button>
            )}
          </div>

          <div className="mb-2 grid grid-cols-[1fr_auto] gap-2">
            <Input placeholder={labels.searchClient} value={clientQ} onChange={(e) => setClientQ(e.target.value)} className="h-10 bg-white text-neutral-900 placeholder:text-neutral-400 focus:bg-white" />
            <select
              value={tierId}
              onChange={(e) => setTierId(e.target.value)}
              className="h-10 rounded-lg border border-(--border-default) bg-(--bg-surface) px-1 text-xs font-bold"
              aria-label={labels.tier}
              title={labels.tier}
            >
              <option value="">{client?.tierId ? "★" : `— ${labels.tier}`}</option>
              {tiers.map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </select>
          </div>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={cn(inputCls, "mb-1 h-10")}>
            <option value="">— {labels.walkin}</option>
            {clientId && !shownClients.some((c) => c.id === clientId) && client && (
              <option value={client.id}>{client.name} · {client.code}</option>
            )}
            {shownClients.map((c) => (
              <option key={c.id} value={c.id}>{c.name} · {c.code}</option>
            ))}
          </select>
          {client && (
            <div className="mb-2 text-xs opacity-60">{labels.balance}: <b>{fmt(client.balance)}</b></div>
          )}

          <div className="mb-2 max-h-64 space-y-1.5 overflow-y-auto lg:max-h-none lg:min-h-0 lg:flex-1">
            {lines.length === 0 && (
              <div className="rounded-xl border border-dashed border-(--border-default) py-6 text-center text-xs opacity-50">
                <ShoppingCart size={22} className="mx-auto mb-1" />
                {labels.empty}
              </div>
            )}
            {lines.map((l, i) => {
              const p = byId.get(l.productId);
              if (!p) return null;
              const price = l.unitPrice === "" ? priceFor(p, l.unitId) : Number(l.unitPrice);
              const units = saleUnits(p, allowPieces);
              return (
                <div key={i} className="rounded-xl border border-(--border-subtle) bg-(--bg-surface) px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => bump(i, -1)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-(--border-default) hover:bg-(--bg-sunken)" aria-label="-">
                      <Minus size={14} />
                    </button>
                    <span className="w-8 shrink-0 text-center text-sm font-black tabular-nums">{l.qty}</span>
                    <button onClick={() => bump(i, 1)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-(--border-default) hover:bg-(--bg-sunken)" aria-label="+">
                      <Plus size={14} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-bold">{p.name}</div>
                      <div className="text-[11px]">
                        <div className="flex items-center gap-1 opacity-60">
                          {units.length > 1 ? (
                            <select
                              value={l.unitId}
                              onChange={(e) => setLine(i, { unitId: e.target.value })}
                              className="rounded bg-transparent text-[11px] font-bold outline-none"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {units.map((u) => (
                                <option key={u.id} value={u.id}>{u.name}</option>
                              ))}
                            </select>
                          ) : (
                            <span>{units[0]?.name ?? ""}</span>
                          )}
                          <span>/</span>
                          <span className="font-black tabular-nums">{fmt(price)} {labels.currency}</span>
                        </div>
                        {(() => {
                          const f = factorOf(p, l.unitId);
                          const piece = p.conversions.filter((c) => c.factor < 1).sort((a, b) => a.factor - b.factor)[0];
                          if (f >= 1 && piece) {
                            const n = Math.round(1 / normFactor(piece.factor));
                            return <div dir="ltr" className="text-end font-bold text-(--brand-600)">{fmt(price / n)} {labels.currency} / {piece.unit.name} =</div>;
                          }
                          if (f < 1) {
                            const n = Math.round(1 / f);
                            return <div dir="ltr" className="text-end font-bold text-(--brand-600)">{fmt(price * n)} {labels.currency} / {p.baseUnit?.name ?? ""} =</div>;
                          }
                          return null;
                        })()}
                      </div>
                      <UnitQty qty={l.qty} factor={factorOf(p, l.unitId)} baseName={baseNameOf(p)} product={p} />
                    </div>
                    <span className="shrink-0 text-[13px] font-black tabular-nums">{fmt(Math.max(0, l.qty * price - l.remise))}</span>
                    <button onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="shrink-0 p-1 text-red-500 opacity-60 hover:opacity-100" aria-label="remove">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {remiseEnabled && lines.length > 0 && (
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-bold opacity-60">{labels.remise}</span>
              <input
                type="number" min={0} step="any" value={docRemise || ""}
                onChange={(e) => setDocRemise(Number(e.target.value))}
                className="h-9 w-28 rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-end text-sm font-bold outline-none focus:border-(--brand-500)"
              />
            </div>
          )}

          <div className="mb-2 flex min-h-20 items-center justify-between rounded-xl bg-(--bg-sunken) px-4 py-3">
            <span className="text-base font-bold opacity-70">{labels.total}</span>
            <span className="text-3xl font-black tabular-nums">{fmt(totals.total)}</span>
          </div>

          <div className="mb-2 flex gap-2">
            <input
              type="number" min={0} step="any" value={paid}
              onChange={(e) => setPaid(e.target.value)}
              placeholder={creditEnabled ? labels.paid : `${labels.paid} (${labels.cashOnly})`}
              className="h-11 min-w-0 flex-1 rounded-lg border border-(--border-default) bg-(--bg-surface) px-3 text-base font-black tabular-nums outline-none focus:border-(--brand-500)"
            />
            <button
              onClick={() => setPaid(String(totals.total))}
              className="shrink-0 rounded-lg border border-(--border-default) px-3 text-xs font-black opacity-70 hover:bg-(--bg-sunken) hover:opacity-100"
            >
              {labels.exact}
            </button>
          </div>

          {paid !== "" && (
            <div
              className={cn(
                "mb-2 rounded-lg px-3 py-1.5 text-center text-sm font-black",
                diff >= 0 ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/10 text-red-500"
              )}
            >
              {diff >= 0 ? `${labels.change}: ${fmt(diff)}` : `${labels.due}: ${fmt(-diff)}`}
            </div>
          )}

          <Button onClick={submit} disabled={busy || lines.length === 0} className="h-12 w-full text-base font-black">
            {busy ? "…" : `${labels.save} · ${fmt(totals.total)}`}
          </Button>
        </div>
      </div>

      <Modal open={done !== null} onClose={reset} title={labels.save} width="sm" icon="✓">
        {done && (
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
              <Check size={32} strokeWidth={3} />
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between rounded-lg bg-(--bg-sunken) px-3 py-2">
                <span className="font-bold opacity-60">{labels.total}</span>
                <b className="tabular-nums">{fmt(done.total)}</b>
              </div>
              <div className="flex justify-between rounded-lg bg-(--bg-sunken) px-3 py-2">
                <span className="font-bold opacity-60">{labels.paid}</span>
                <b className="tabular-nums">{fmt(done.paid)}</b>
              </div>
              <div className={cn(
                "flex justify-between rounded-lg px-3 py-2 font-black",
                done.paid - done.total >= 0 ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/10 text-red-500"
              )}>
                <span>{done.paid - done.total >= 0 ? labels.change : labels.due}</span>
                <span className="tabular-nums">{fmt(Math.abs(done.paid - done.total))}</span>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Link href={`/${locale}/sales/${done.id}`} className="flex-1">
                <Button variant="secondary" className="w-full">
                  <ReceiptText size={16} className="me-1" />
                  {labels.save}
                </Button>
              </Link>
              <Button onClick={reset} className="flex-[2]">
                <Plus size={16} className="me-1" />
                {labels.newSale}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
