"use client";

import { QtyLadderHint } from "@/components/sales/QtyLadderHint";
import { ladderLine } from "@/lib/pricing";
import { matchClient } from "@/lib/clients/display";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/Input";
import { Minus, Package, Plus, ShoppingBasket, Trash2, UserRound, Wallet, Store, StickyNote } from "lucide-react";
import { SaleProductPicker } from "@/components/sales/SaleProductPicker";
import { Avatar } from "@/components/ui/Avatar";
import { dzMoney } from "@/lib/format";
import { UnitQty, PackInfo, factorOf, baseNameOf, saleUnits } from "@/components/products/UnitQty";
import { cn } from "@/lib/utils";
import { getVanSnapshot, getOutbox, type VanSnapshot } from "@/lib/sync/client";
import { queueOp } from "@/lib/sync/client";
import { checkOfflineSale } from "@/lib/sync/offline-rules";
import type { OutboxRow } from "@/lib/sync/offline-db";
import { ProductSelect, type PickerProduct } from "@/components/threepack/ProductPicker";
import { GiftLineRow, colisMap, giftBodyLines, lineBaseQty, useGifts, useThreePackRules } from "@/components/threepack/useThreePack";
import { applyDeals } from "@/lib/threepack/match";

import { ErrText } from "@/components/ui/ErrText";
export type DocClient = { id: string; name: string; code: string; tierId: string | null; balance: unknown };
export type DocProduct = {
  id: string;
  name: string;
  salePrice: number;
  colisage?: string | null;
  barcode?: string | null;
  baseUnitId: string | null;
  baseUnit: { id: string; name: string } | null;
  saleUnitId: string | null;
  conversions: Array<{ unitId: string; factor: number; barcode?: string | null; unit: { id: string; name: string } }>;
  tierPrices: Array<{ tierId: string; price: number }>;
  /// Quantity ladder per colisage (see lib/pricing).
  qtyTiers?: Array<{ unitKey: string; minQty: number; tierId: string | null }>;
  images?: Array<{ url: string }>;
  category?: { id: string; name: string } | null;
};
export type DocLine = { productId: string; unitId: string; qty: number; unitPrice: string; remise: number };


const TX = {
  ar: { lines: "المنتجات", pick: "اختيار المنتجات", picker: { title: "اختيار المنتجات", search: "ابحث بالاسم أو الباركود…", all: "الكل", selected: "المحدد", matches: "النتائج", selectAll: "تحديد الكل", clear: "إلغاء التحديد", add: "إضافة المحدد", noProducts: "لا توجد منتجات", added: "مضاف", cancel: "إلغاء" } },
  fr: { lines: "Produits", pick: "Choisir les produits", picker: { title: "Choisir les produits", search: "Nom ou code-barres…", all: "Tous", selected: "Sélectionnés", matches: "Résultats", selectAll: "Tout cocher", clear: "Tout décocher", add: "Ajouter la sélection", noProducts: "Aucun produit", added: "Ajouté", cancel: "Annuler" } },
  en: { lines: "Products", pick: "Pick products", picker: { title: "Pick products", search: "Name or barcode…", all: "All", selected: "Selected", matches: "Matches", selectAll: "Select all", clear: "Clear", add: "Add selected", noProducts: "No products", added: "Added", cancel: "Cancel" } },
} as const;


/// Shared order/ticket editor: tier pricing, conversions, remise, paid.
export function SaleDocForm({
  locale,
  mode,
  channel,
  clients,
  products,
  units,
  tiers,
  locations,
  remiseEnabled,
  creditEnabled,
  allowPieces = false,
  defaultTierId,
  lockTier = false,
  presetClientId,
  presetLocationId,
  presetTourneeId,
  labels,
  onCreated,
  editingId,
  initial,
}: {
  locale: string;
  mode: "order" | "ticket";
  channel?: "VAN" | "POS" | "DEPOT";
  clients: DocClient[];
  products: DocProduct[];
  units: Array<{ id: string; name: string }>;
  tiers: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string; kind: string }>;
  remiseEnabled: boolean;
  creditEnabled: boolean;
  allowPieces?: boolean;
  defaultTierId?: string;
  /// Livreur flow: price comes from purchases/client category only —
  /// render the effective tier read-only instead of a selector.
  lockTier?: boolean;
  presetClientId?: string;
  presetLocationId?: string;
  presetTourneeId?: string;
  labels: Record<string, string>;
  /// Called with the created doc id. Defaults to opening the detail page
  /// (route usage); the list-page modal closes + navigates itself.
  onCreated?: (id: string) => void;
  /// Edit mode: rewrite a posted TICKET in place (same number/date) instead
  /// of creating. Requires online (server reverses + re-applies postings).
  editingId?: string;
  initial?: {
    clientId: string | null;
    locationId: string | null;
    tierId?: string | null;
    remise?: number;
    paid?: number;
    notes?: string | null;
    lines: Array<{ productId: string; unitId: string | null; qty: number; unitPrice: number | null; remise?: number | null }>;
  } | null;
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState(initial?.clientId ?? presetClientId ?? "");
  const [locationId, setLocationId] = useState(initial?.locationId ?? presetLocationId ?? "");
  const [tierId, setTierId] = useState(initial?.tierId ?? defaultTierId ?? "");
  const [qrScanned, setQrScanned] = useState(false);
  const [docRemise, setDocRemise] = useState(initial?.remise ?? 0);
  const [paid, setPaid] = useState(initial?.paid != null ? String(initial.paid) : "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [clientQ, setClientQ] = useState("");
  const [lines, setLines] = useState<DocLine[]>(
    initial?.lines?.length
      ? initial.lines.map((l) => ({
          productId: l.productId,
          unitId: l.unitId ?? "",
          qty: l.qty,
          unitPrice: l.unitPrice != null ? String(l.unitPrice) : "",
          remise: l.remise ?? 0,
        }))
      : [{ productId: "", unitId: "", qty: 1, unitPrice: "", remise: 0 }]
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [snap, setSnap] = useState<VanSnapshot | null>(null);
  /// Live "QR strict" from the server — beats the stale synced snapshot copy.
  const [liveQr, setLiveQr] = useState<boolean | null>(null);
  useEffect(() => {
    if (mode !== "ticket") return;
    let live = true;
    fetch("/api/settings/public", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d && typeof d.qrStrictMode === "boolean") setLiveQr(d.qrStrictMode); })
      .catch(() => {});
    return () => { live = false; };
  }, [mode]);
  const [ops, setOps] = useState<OutboxRow[]>([]);
  /// Synchronous double-tap guard.
  const busyRef = useRef(false);
  /// Main-depot availability (order mode only — commandes are prepared
  /// from the depot, never the van). Online API first, snapshot fallback.
  /// null = unknown (fetch failed); {} = known, missing product means 0.
  const [depot, setDepot] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    let live = true;
    getVanSnapshot().then((s) => {
      if (live) setSnap(s);
    });
    getOutbox().then((o) => {
      if (live) setOps(o);
    });
    return () => {
      live = false;
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    if (mode !== "order") return;
    let live = true;
    fetch("/api/stock/depot", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d && typeof d === "object") setDepot(d as Record<string, number>);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [mode]);

  /// Offline-first: when the network is down (or server props never arrived),
  /// sell from the on-device snapshot — same prices, units and colisage.
  const snapshotActive = (!online || products.length === 0) && snap !== null;
  const effProducts: DocProduct[] = useMemo(() => {
    if (!snapshotActive || !snap) return products;
    return snap.products.map((p) => ({
      id: p.id,
      name: p.name,
      salePrice: p.salePrice,
      colisage: p.colisage,
      barcode: p.barcode,
      baseUnitId: p.baseUnit?.id ?? null,
      baseUnit: p.baseUnit,
      saleUnitId: null,
      conversions: p.conversions.map((c) => ({
        unitId: c.unitId,
        factor: c.factor,
        barcode: c.barcode,
        unit: { id: c.unitId, name: c.name },
      })),
      tierPrices: p.tierPrices,
    }));
  }, [snapshotActive, snap, products]);
  /// Photo / search / category picker data for the line product field.
  const pickerProducts: PickerProduct[] = useMemo(
    () =>
      effProducts.map((p) => {
        const pack = p.conversions.filter((c) => Number(c.factor) > 1).sort((a, b) => Number(a.factor) - Number(b.factor))[0];
        return {
          id: p.id,
          name: p.name,
          reference: p.barcode ?? null,
          imageUrl: p.images?.[0]?.url ?? null,
          category: p.category ?? null,
          colisLabel: pack ? `${pack.unit.name} × ${Number(pack.factor)}` : null,
        };
      }),
    [effProducts],
  );
  const pickerCategories = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of effProducts) if (p.category) m.set(p.category.id, p.category.name);
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [effProducts]);
  const effClients: DocClient[] = useMemo(() => {
    if (!snapshotActive || !snap) return clients;
    return snap.clients.map((c) => ({ id: c.id, name: c.name, code: c.code, tierId: c.tierId, balance: c.balance }));
  }, [snapshotActive, snap, clients]);

  const client = effClients.find((c) => c.id === clientId);
  const effTier = tierId || client?.tierId || "";

  // 3pack: free colis appear automatically as read-only rows (price 0). Derived
  // from the purchased lines on every change; the server recomputes on save.
  const t3 = useTranslations("threepack");
  const tProd = useTranslations("products");
  const tpRules = useThreePackRules(snap, online);
  const gifts = useGifts(tpRules, effProducts, lines);
  const giftLines = useMemo(() => giftBodyLines(gifts), [gifts]);

  /// Unit price at this quantity: the product's ladder (per colisage) picks the
  /// tier when it has one, otherwise the client / chosen tier — same rule as the server.
  function priceFor(p: DocProduct, unitId = "", qty = 1): number {
    return ladderLine(p, unitId, qty, effTier || null).unitPrice;
  }

  const unitOptions = (p: DocProduct | undefined) => saleUnits(p, allowPieces);

  const totals = useMemo(() => {
    const priced = lines.map((l) => {
      const p = effProducts.find((x) => x.id === l.productId);
      const price = l.unitPrice === "" ? (p ? priceFor(p, l.unitId, l.qty) : 0) : Number(l.unitPrice);
      return {
        productId: l.productId, qty: l.qty, baseQty: lineBaseQty(effProducts, l), unitPrice: price, remise: l.remise,
        lineTotal: Math.max(0, l.qty * price - l.remise), manualPrice: l.unitPrice !== "",
      };
    });
    const before = priced.reduce((s, l) => s + l.lineTotal, 0);
    // % off / new-price deals (the server applies the same to blank-price lines).
    const dealt = tpRules.length ? applyDeals(tpRules, priced.filter((l) => l.productId && l.qty > 0), colisMap(effProducts)) : priced;
    const linesTotal = tpRules.length ? dealt.reduce((s, l) => s + l.lineTotal, 0) + priced.filter((l) => !(l.productId && l.qty > 0)).reduce((s, l) => s + l.lineTotal, 0) : before;
    return { linesTotal, total: Math.max(0, linesTotal - docRemise), dealSaving: Math.round((before - linesTotal) * 100) / 100 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, docRemise, effTier, effProducts, tpRules]);

  const paidNum = paid === "" ? (mode === "ticket" ? totals.total : 0) : Number(paid);

  function setLine(i: number, patch: Partial<DocLine>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  const shownClients = clientQ
    ? effClients.filter((c) => matchClient(clientQ, c)).slice(0, 30)
    : effClients.slice(0, 30);

  async function submit() {
    if (busyRef.current) return;
    setError(null);
    const valid = lines.filter((l) => l.productId && l.qty > 0);
    if (!valid.length) {
      setError("lines_required");
      return;
    }
    if (mode === "order" && !clientId) {
      setError("client_required");
      return;
    }
    if (mode === "ticket" && !locationId) {
      setError("location_required");
      return;
    }
    // Mirror the server's ticket rules locally (QR/credit/stock/remise) so an
    // offline sale the PC would reject is caught before it's queued.
    if (mode === "ticket") {
      const check = checkOfflineSale({
        snap: snap && liveQr !== null ? { ...snap, settings: { ...snap.settings, qrStrictMode: liveQr } } : snap,
        ops,
        channel: channel ?? "VAN",
        clientId: clientId || null,
        lines: valid.map((l) => ({
          productId: l.productId,
          unitId: l.unitId || null,
          qty: l.qty,
          unitPrice: l.unitPrice === "" ? (effProducts.find((x) => x.id === l.productId) ? priceFor(effProducts.find((x) => x.id === l.productId)!, l.unitId, l.qty) : 0) : Number(l.unitPrice),
          remise: l.remise,
        })).concat(giftLines.map((g) => ({ ...g, unitId: g.unitId ?? null }))),
        remise: docRemise,
        paid: paidNum,
        qrScanned,
        vanId: locationId,
        // Validate the gift against the rules it was computed from (live rules
        // may be newer than the snapshot), converting units with this form's products.
        bonus: {
          rules: tpRules,
          colis: colisMap(effProducts),
          baseQtyOf: (l) => lineBaseQty(effProducts, l),
        },
      });
      if (!check.ok) {
        setError(check.error);
        return;
      }
    }
    busyRef.current = true;
    setBusy(true);
    try {
      // Edit mode: rewrite the posted ticket in place (Admin, online only —
      // the server reverses + re-applies stock/debt, no offline queue).
      if (editingId) {
        const editBody = {
          action: mode === "order" ? "update-order" : "edit",
          clientId: clientId || null,
          locationId,
          tierId: effTier || null,
          remise: docRemise,
          paid: paidNum,
          notes: notes || null,
          lines: valid.map((l) => ({
            productId: l.productId,
            unitId: l.unitId || null,
            qty: l.qty,
            unitPrice: l.unitPrice === "" ? null : Number(l.unitPrice),
            remise: l.remise,
          })).concat(giftLines as never[]),
        };
        const res = await fetch(`/api/sales/${editingId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editBody),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "save_failed");
          return;
        }
        if (onCreated) onCreated(data.id ?? editingId);
        return;
      }
      const url = mode === "order" ? "/api/sales/orders" : "/api/sales/tickets";
      const body =
        mode === "order"
          ? {
              clientId,
              tierId: effTier || null,
              remise: docRemise,
              paid: paidNum,
              notes: notes || null,
              tourneeId: presetTourneeId ?? null,
              lines: valid.map((l) => ({
                productId: l.productId,
                unitId: l.unitId || null,
                qty: l.qty,
                unitPrice: l.unitPrice === "" ? null : Number(l.unitPrice),
                remise: l.remise,
              })).concat(giftLines as never[]),
            }
          : {
              clientId: clientId || null,
              locationId,
              tierId: effTier || null,
              channel: channel ?? "VAN",
              qrScanned,
              tourneeId: presetTourneeId ?? null,
              remise: docRemise,
              paid: paidNum,
              notes: notes || null,
              lines: valid.map((l) => ({
                productId: l.productId,
                unitId: l.unitId || null,
                qty: l.qty,
                unitPrice: l.unitPrice === "" ? null : Number(l.unitPrice),
                remise: l.remise,
              })).concat(giftLines as never[]),
            };
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(
        async (netErr: unknown) => {
          // Offline van sale/commande: queue into the on-device outbox, sync
          // when connected (ticket → immediate sale, order → bon de commande
          // for the admin to confirm in Commandes).
          if (mode === "ticket" || mode === "order") {
            try {
              await queueOp(mode, body as Record<string, unknown>);
              setOps(await getOutbox());
            } catch {
              setError("save_failed");
              return null;
            }
            setQueued(true);
            return null;
          }
          throw netErr;
        }
      );
      if (!res) return;
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "save_failed");
        return;
      }
      if (onCreated) {
        onCreated(data.id);
      } else {
        router.push(`/${locale}/sales/${data.id}`);
        router.refresh();
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const tx = TX[locale === "fr" || locale === "en" ? locale : "ar"];
  const defUnit = (np: DocProduct | undefined) => {
    const opts = saleUnits(np, allowPieces);
    return np?.saleUnitId && opts.some((u) => u.id === np.saleUnitId) ? np.saleUnitId : (opts[0]?.id ?? np?.baseUnitId ?? "");
  };
  const depotText = (p: DocProduct | undefined, id: string): string | null => {
    const q = depot ? (depot[id] ?? 0) : Number(snap?.depotStock?.find((b) => b.productId === id)?.qty ?? NaN);
    if (!Number.isFinite(q)) return null;
    const pack = p?.conversions?.filter((c) => Number(c.factor) > 1).sort((a, b) => Number(a.factor) - Number(b.factor))[0];
    if (!pack) return `${q} ${p?.baseUnit?.name ?? ""}`;
    const f = Number(pack.factor);
    const whole = Math.floor(q / f);
    const rest = Math.round((q - whole * f) * 1000) / 1000;
    return `${whole} ${pack.unit.name}${rest > 0 ? ` + ${rest} ${p?.baseUnit?.name ?? ""}` : ""}`;
  };
  /// Multi-add from the picker: one line per ticked product; a lone empty starter row is replaced.
  function addPicked(picked: Array<{ product: DocProduct; qty: number }>) {
    setLines((ls) => {
      const taken = new Set(ls.map((l) => l.productId).filter(Boolean));
      const fresh: DocLine[] = picked
        .filter((x) => !taken.has(x.product.id))
        .map((x) => ({ productId: x.product.id, unitId: defUnit(x.product), qty: x.qty, unitPrice: "", remise: 0 }));
      if (!fresh.length) return ls;
      if (ls.length === 1 && !ls[0].productId) return fresh;
      return [...ls, ...fresh];
    });
  }
  const filledLines = lines.filter((l) => l.productId).length;
  const inputC = "h-11 w-full rounded-xl border border-(--border-default) bg-(--bg-surface) px-2.5 text-sm font-bold outline-none";
  const secLabel = "mb-1.5 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-(--text-tertiary)";
  const balanceN = Number(client?.balance ?? 0);

  return (
    <div className="space-y-4">
      {error && <p className="rounded-xl bg-red-500/10 p-2.5 text-sm font-bold text-red-500"><ErrText code={error} /></p>}
      {snapshotActive && <p className="rounded-xl bg-amber-500/10 p-2.5 text-sm font-bold text-amber-600">{labels.offlineMode}</p>}
      {queued && <p className="rounded-xl bg-amber-500/10 p-2.5 text-sm font-bold text-amber-600">⏳ queued offline — will sync</p>}

      {/* ── customer & options ── */}
      <section className="rounded-2xl border border-(--border-default) bg-(--bg-sunken) p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className={secLabel}><UserRound size={12} />{labels.client}</div>
            <Input placeholder={labels.searchClient} value={clientQ} onChange={(e) => setClientQ(e.target.value)} className="mb-1.5 h-11 rounded-xl" />
            <select value={clientId} onChange={(e) => { setClientId(e.target.value); setLines((ls) => ls.map((l) => ({ ...l, unitPrice: "" }))); }} className={inputC}>
              <option value="">— {mode === "order" ? labels.required : labels.walkin}</option>
              {clientId && !shownClients.some((c) => c.id === clientId) && client && <option value={client.id}>{client.name} · {client.code}</option>}
              {shownClients.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.code}</option>)}
            </select>
            {client && (
              <div className="mt-2 flex items-center gap-2.5 rounded-xl bg-(--bg-overlay) p-2">
                <Avatar name={client.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-black">{client.name}</div>
                  <div className="font-mono text-[11px] text-(--text-tertiary)" dir="ltr">{client.code}</div>
                </div>
                <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black tabular-nums", balanceN > 0 ? "bg-red-500/15 text-(--semantic-danger)" : "bg-emerald-500/15 text-(--semantic-success)")} title={labels.balance}>
                  {labels.balance}: {dzMoney(balanceN)}
                </span>
              </div>
            )}
          </div>
          <div className="space-y-3">
            <div>
              <div className={secLabel}><Wallet size={12} />{labels.tier}</div>
              {lockTier ? (
                <div className={cn(inputC, "flex items-center opacity-70")}>{tiers.find((x) => x.id === effTier)?.name ?? "—"}</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {tiers.map((x) => (
                    <button
                      key={x.id}
                      type="button"
                      onClick={() => { setTierId(x.id); setLines((ls) => ls.map((l) => ({ ...l, unitPrice: "" }))); }}
                      className={cn("min-h-11 rounded-xl border px-3 py-2 text-xs font-black transition-all", effTier === x.id ? "border-transparent bg-gradient-brand text-(--brand-contrast) shadow" : "border-(--border-default) bg-(--bg-overlay) text-(--text-secondary) hover:border-(--brand-500)")}
                    >
                      {x.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {mode === "ticket" && (
              <div>
                <div className={secLabel}><Store size={12} />{labels.location}</div>
                <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputC}>
                  <option value="">—</option>
                  {locations.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                {channel === "VAN" && (
                  <label className="mt-2 flex items-center gap-2 text-xs font-bold">
                    <input type="checkbox" checked={qrScanned} onChange={(e) => setQrScanned(e.target.checked)} className="h-5 w-5" />
                    {labels.qrScanned}
                  </label>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── products ── */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className={cn(secLabel, "mb-0")}><ShoppingBasket size={13} />{tx.lines} <span className="rounded-full bg-(--brand-500)/15 px-2 text-(--gold-text)">{filledLines}</span></div>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => setPickerOpen(true)} className="bg-gradient-brand flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 text-xs font-black text-(--brand-contrast) transition-transform hover:-translate-y-0.5">
              <Package size={14} />{tx.pick}
            </button>
            <button type="button" onClick={() => setLines((ls) => [...ls, { productId: "", unitId: "", qty: 1, unitPrice: "", remise: 0 }])} className="flex min-h-11 items-center gap-1 whitespace-nowrap rounded-xl border border-(--border-default) px-3 text-xs font-black text-(--text-secondary) hover:border-(--brand-500)">
              <Plus size={14} />{labels.addLine}
            </button>
          </div>
        </div>

        {lines.map((l, i) => {
          const p = effProducts.find((x) => x.id === l.productId);
          const price = l.unitPrice === "" ? (p ? priceFor(p, l.unitId, l.qty) : 0) : Number(l.unitPrice);
          const lineTotal = Math.max(0, l.qty * price - l.remise);
          const img = p?.images?.[0]?.url;
          const uopts = unitOptions(p);
          const stock = mode === "order" && l.productId ? depotText(p, l.productId) : null;
          return (
            <div key={i} className="relative rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3 transition-shadow hover:shadow-[0_10px_28px_-18px_var(--brand-500)]">
              <button type="button" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [{ productId: "", unitId: "", qty: 1, unitPrice: "", remise: 0 }]))} aria-label="remove" className="absolute end-0 top-0 flex h-11 min-h-0 w-11 min-w-0 items-center justify-center rounded-lg text-(--text-tertiary) hover:bg-red-500/10 hover:text-red-500">
                <Trash2 size={14} />
              </button>
              <div className="flex flex-wrap gap-3">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-(--bg-sunken)">
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img} alt={p?.name ?? ""} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-(--text-tertiary)"><Package size={22} /></div>
                  )}
                </div>
                <div className="min-w-[9rem] flex-1 pe-11">
                  {p ? (
                    <>
                      <div className="truncate text-sm font-black">{p.name}</div>
                      <PackInfo product={p} unitId={l.unitId} />
                      {stock && <div className="mt-0.5 truncate text-[11px] font-bold text-(--gold-text)">🏭 {labels.depotStock}: <span className="tabular-nums" dir="ltr">{stock}</span></div>}
                    </>
                  ) : (
                    <ProductSelect
                      products={pickerProducts}
                      categories={pickerCategories}
                      value={l.productId}
                      onChange={(id) => { const np = effProducts.find((x) => x.id === id); setLine(i, { productId: id, unitId: defUnit(np) }); }}
                      placeholder={labels.product}
                      title={labels.product}
                    />
                  )}
                </div>
              </div>
              {p && (
                <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2 sm:grid-cols-[1.1fr_1.2fr_1fr_1fr]">
                  <div>
                    <div className="mb-1 text-[11px] font-bold text-(--text-tertiary)">{labels.unit}</div>
                    {uopts.length <= 3 ? (
                      <div className="flex gap-1">
                        {uopts.map((u) => (
                          <button key={u.id} type="button" onClick={() => setLine(i, { unitId: u.id })} className={cn("min-h-11 flex-1 rounded-lg border px-1.5 py-2 text-[11px] font-black transition-all", l.unitId === u.id ? "border-(--brand-500) bg-(--brand-500)/15 text-(--gold-text)" : "border-(--border-default) text-(--text-secondary)")}>{u.name}</button>
                        ))}
                      </div>
                    ) : (
                      <select value={l.unitId} onChange={(e) => setLine(i, { unitId: e.target.value })} className={inputC}>{uopts.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                    )}
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-bold text-(--text-tertiary)">{labels.qty}</div>
                    <div className="flex h-11 items-center overflow-hidden rounded-xl border border-(--border-default) bg-(--bg-surface)">
                      <button type="button" onClick={() => setLine(i, { qty: Math.max(0, Math.round((l.qty - 1) * 1000) / 1000) })} className="flex h-full min-h-0 w-10 min-w-0 items-center justify-center text-(--text-secondary) hover:bg-(--bg-sunken)" aria-label="-"><Minus size={14} /></button>
                      <input type="number" min={0} step="any" value={l.qty} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} className="h-full min-w-0 flex-1 border-0 bg-transparent text-center text-sm font-black tabular-nums outline-none" />
                      <button type="button" onClick={() => setLine(i, { qty: Math.round((l.qty + 1) * 1000) / 1000 })} className="flex h-full min-h-0 w-10 min-w-0 items-center justify-center text-(--text-secondary) hover:bg-(--bg-sunken)" aria-label="+"><Plus size={14} /></button>
                    </div>
                    <UnitQty qty={l.qty} factor={factorOf(p, l.unitId)} baseName={baseNameOf(p)} product={p} />
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-bold text-(--text-tertiary)">{labels.price}</div>
                    <Input type="number" min={0} step="any" value={l.unitPrice} placeholder={String(price)} onChange={(e) => setLine(i, { unitPrice: e.target.value })} className="h-11 rounded-xl text-center font-black" />
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-bold text-(--text-tertiary)">{labels.lineTotal}</div>
                    <div className="flex h-11 items-center justify-center rounded-xl bg-(--gold-wash) text-sm font-black tabular-nums text-(--gold-text)" dir="ltr">{dzMoney(lineTotal)}</div>
                  </div>
                  {remiseEnabled && (
                    <div>
                      <div className="mb-1 text-[11px] font-bold text-(--text-tertiary)">{labels.remise}</div>
                      <Input type="number" min={0} step="any" value={l.remise} onChange={(e) => setLine(i, { remise: Number(e.target.value) })} className="h-11 rounded-xl text-center" />
                    </div>
                  )}
                </div>
              )}
              {p && l.unitPrice === "" && (
                <QtyLadderHint
                  product={p}
                  unitId={l.unitId}
                  qty={l.qty}
                  fallbackTierId={effTier || null}
                  tierName={(id) => (id ? (tiers.find((x) => x.id === id)?.name ?? "—") : tProd("salePrice"))}
                  onJump={(q) => setLine(i, { qty: q })}
                />
              )}
            </div>
          );
        })}

        {/* 3pack: automatic free colis (price 0, deducted from stock) */}
        {gifts.map((g) => (
          <GiftLineRow
            key={`${g.ruleId}:${g.productId}`}
            gift={g}
            product={effProducts.find((x) => x.id === g.productId)}
            freeLabel={t3("free")}
            money={dzMoney(0)}
          />
        ))}
      </section>

      {/* ── summary (sticky) ── */}
      <section className="sticky bottom-0 -mx-1 space-y-2 [@media(max-height:700px)]:static rounded-2xl border border-(--border-strong) bg-(--bg-overlay)/95 p-2.5 shadow-[0_-12px_30px_-18px_rgba(0,0,0,0.5)] backdrop-blur">
        <div className={cn("grid items-stretch gap-2", remiseEnabled ? "grid-cols-2 sm:grid-cols-[1fr_1fr_1.1fr_1.2fr]" : "grid-cols-2 sm:grid-cols-[1fr_1.1fr_1.3fr]")}>
          {remiseEnabled && (
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-black uppercase text-(--text-tertiary)">{labels.remise}</span>
              <Input type="number" min={0} step="any" value={docRemise} onChange={(e) => setDocRemise(Number(e.target.value))} className="h-11 rounded-xl" />
            </label>
          )}
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-black uppercase text-(--text-tertiary)">{labels.paid} {creditEnabled ? "" : `(${labels.cashOnly})`}</span>
            <Input type="number" min={0} step="any" value={paid} placeholder={String(totals.total.toFixed(2))} onChange={(e) => setPaid(e.target.value)} className="h-11 rounded-xl" />
          </label>
          <div className="bg-gradient-brand flex flex-col justify-center rounded-xl px-3 text-(--brand-contrast)">
            <span className="break-words text-[11px] font-black uppercase opacity-70">{labels.total}</span>
            <span className="text-lg font-black leading-tight tabular-nums" dir="ltr">{dzMoney(totals.total)}</span>
            {totals.dealSaving > 0 && <span className="text-[11px] font-black tabular-nums opacity-90" dir="ltr">🏷 −{dzMoney(totals.dealSaving)}</span>}
          </div>
          <button type="button" onClick={submit} disabled={busy} className="col-span-2 min-h-11 rounded-xl bg-(--text-primary) text-sm font-black text-(--bg-overlay) transition-transform hover:-translate-y-0.5 disabled:opacity-60 sm:col-span-1">
            {busy ? "…" : labels.save}
          </button>
        </div>
        <label className="flex items-center gap-2 rounded-xl border border-(--border-default) bg-(--bg-surface) px-3">
          <StickyNote size={13} className="shrink-0 text-(--text-tertiary)" />
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={labels.notes} className="h-11 w-full border-0 bg-transparent text-xs font-bold outline-none" />
        </label>
      </section>

      <SaleProductPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        products={effProducts}
        takenIds={lines.map((l) => l.productId).filter(Boolean)}
        priceOf={(p) => priceFor(p, defUnit(p))}
        stockOf={mode === "order" ? (p) => depotText(p, p.id) : undefined}
        subtitle={client?.name}
        text={tx.picker}
        onAdd={addPicked}
      />
    </div>
  );
}
