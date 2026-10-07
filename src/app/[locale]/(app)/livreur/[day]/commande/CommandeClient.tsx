"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownUp, ArrowLeft, ClipboardList, Minus, Plus, QrCode } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { CameraBox } from "@/components/scan/CameraBox";
import { normFactor, saleUnits } from "@/components/products/UnitQty";
import { queueOp, getVanSnapshot, getLastSync, type VanSnapshot } from "@/lib/sync/client";
import { beepAdd, beepConfirm } from "@/lib/beep";
import { cn } from "@/lib/utils";

type Client = { id: string; name: string; code: string; phone: string | null; tierId: string | null; balance: unknown };
type Prod = {
  id: string; name: string; reference: string | null;
  baseUnitId: string | null;
  baseUnit: { id: string; name: string } | null;
  images: Array<{ url: string }>;
  conversions: Array<{ unitId: string; factor: unknown; unit: { name: string } }>;
  category: { id: string; name: string } | null;
};
type Line = { productId: string; unitId: string | null; qty: number };

/// Livreur "طلب جديد" — like the sales flow (scan → products → qty → recap)
/// but a pure REQUEST: no prices, no payment. Lands as a DRAFT order for the
/// admin to confirm (stock is only promised at confirm/deliver).
export function CommandeClient({
  locale,
  day,
  vanId,
  vanName,
  tourneeId,
  initialClient,
  products,
  categories,
  depotStock,
  allowPieces,
  labels,
}: {
  locale: string;
  day: string;
  vanId: string;
  vanName: string;
  tourneeId: string | null;
  initialClient: Client | null;
  products: Prod[];
  categories: Array<{ id: string; name: string }>;
  depotStock: Record<string, number>;
  allowPieces: boolean;
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [scanOpen, setScanOpen] = useState(!initialClient);
  const [client, setClient] = useState<Client | null>(initialClient);
  const [cat, setCat] = useState("");
  const [pq, setPq] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [showRecap, setShowRecap] = useState(false);
  const [notes, setNotes] = useState("");
  const [qtyFor, setQtyFor] = useState<Prod | null>(null);
  const [qtyPacks, setQtyPacks] = useState(1);
  const [qtyUnits, setQtyUnits] = useState(0);
  const [saving, setSaving] = useState(false);
  /// Synchronous double-tap guard.
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { queued: boolean }>(null);
  const [gallery, setGallery] = useState<Prod | null>(null);
  const [gIdx, setGIdx] = useState(0);
  const [freshStock, setFreshStock] = useState<number | null>(null);
  /// Whether the qty-popup depot number is live (else: last-synced snapshot).
  const [depotLive, setDepotLive] = useState(false);
  /// Offline snapshot (first sync seeds it all): catalog + depot stock.
  const [snap, setSnap] = useState<VanSnapshot | null>(null);
  /// When that depot snapshot was taken (shown next to depot numbers).
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  useEffect(() => {
    getVanSnapshot().then(setSnap).catch(() => {});
    try {
      setSyncedAt(getLastSync());
    } catch { /* ignore */ }
  }, []);
  const pressTimer = useRef(0);
  const touchX = useRef<number | null>(null);

  /// Offline fallbacks from the synced snapshot (first sync seeds it all).
  const snapProds: Prod[] | null = snap ? (() => {
    const catName = new Map((snap.categories ?? []).map((c) => [c.id, c.name]));
    return snap.products.map((p) => ({
      id: p.id,
      name: p.name,
      reference: p.reference,
      baseUnitId: p.baseUnit?.id ?? null,
      baseUnit: p.baseUnit,
      images: p.images.map((url) => ({ url })),
      conversions: p.conversions.map((c) => ({ unitId: c.unitId, factor: c.factor, unit: { name: c.name } })),
      category: p.categoryId ? { id: p.categoryId, name: catName.get(p.categoryId) ?? "" } : null,
    }));
  })() : null;
  const effProducts = products.length > 0 ? products : (snapProds ?? []);
  const effCategories = categories.length > 0 ? categories : (snap?.categories ?? []);
  const snapDepot = (() => {
    if (!snap?.depotStock) return null;
    const m: Record<string, number> = {};
    for (const b of snap.depotStock) m[b.productId] = Number(b.qty);
    return m;
  })();
  const depotOf = (pid: string) => depotStock[pid] ?? snapDepot?.[pid] ?? 0;

  const filteredProducts = effProducts.filter(
    (p) =>
      (!cat || p.category?.id === cat) &&
      (!pq || p.name.includes(pq) || (p.reference ?? "").includes(pq))
  );

  function onScan(text: string) {
    const code = text.includes("/") ? text.split("/").pop()! : text;
    const match = (rows: Client[]) => rows.find((c) => c.code === code) ?? rows[0];
    fetch(`/api/clients?q=${encodeURIComponent(code)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Client[]) => {
        const hit = match(rows);
        if (hit) {
          setClient(hit);
          setScanOpen(false);
          beepAdd();
        }
      })
      .catch(() => {
        // Offline: match the synced client list.
        const hit = snap ? match(snap.clients as unknown as Client[]) : undefined;
        if (hit) {
          setClient(hit);
          setScanOpen(false);
          beepAdd();
        }
      });
  }

  function packOf(p: Prod) {
    return p.conversions
      .filter((c) => Number(c.factor) > 1)
      .sort((a, b) => Number(a.factor) - Number(b.factor))[0];
  }

  /// Depot snapshot age: "14:32" (or date + time when not today).
  function syncAge(): string {
    if (!syncedAt) return "";
    try {
      const d = new Date(syncedAt);
      const now = new Date();
      const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
      return d.toDateString() === now.toDateString()
        ? time
        : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
    } catch {
      return "";
    }
  }

  function unitName(p: Prod, unitId: string | null): string {
    if (!unitId || unitId === p.baseUnitId) return p.baseUnit?.name ?? "";
    return p.conversions.find((c) => c.unitId === unitId)?.unit.name ?? "";
  }

  function openQty(p: Prod) {
    setQtyFor(p);
    setQtyPacks(1);
    setQtyUnits(0);
    setFreshStock(null);
    setDepotLive(false);
    // Fresh depot availability (cards may be stale).
    fetch("/api/stock/depot", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d[p.id] === "number") {
          setFreshStock(Number(d[p.id]));
          setDepotLive(true);
        } else if (snapDepot && typeof snapDepot[p.id] === "number") setFreshStock(snapDepot[p.id]);
      })
      .catch(() => {
        // Offline: snapshot depot stock from the last sync.
        if (snapDepot && typeof snapDepot[p.id] === "number") setFreshStock(snapDepot[p.id]);
      });
  }

  function addQty() {
    if (!qtyFor) return;
    const p = qtyFor;
    const pack = packOf(p);
    const live = freshStock ?? depotOf(p.id);
    const avail = Math.max(0, live);
    const f = pack ? normFactor(Number(pack.factor)) : 0;
    const packs = f ? Math.min(qtyPacks, Math.floor(avail / f)) : 0;
    const units = Math.min(qtyUnits, Math.floor(avail));
    const opts = saleUnits({ ...p, conversions: p.conversions.map((c) => ({ ...c, factor: Number(c.factor) })) } as never, allowPieces);
    if (pack && packs > 0) {
      setLines((prev) => [...prev, { productId: p.id, unitId: pack.unitId, qty: packs }]);
    } else if (units > 0 && opts.some((o) => o.id === (p.baseUnitId ?? ""))) {
      setLines((prev) => [...prev, { productId: p.id, unitId: p.baseUnitId, qty: units }]);
    } else if (units > 0) {
      setLines((prev) => [...prev, { productId: p.id, unitId: null, qty: units }]);
    } else return;
    beepAdd();
    setQtyFor(null);
  }

  const totalUnits = lines.length;

  function bump(i: number, d: number) {
    setLines((prev) =>
      prev.map((l, j) => (j === i ? { ...l, qty: Math.max(0, l.qty + d) } : l)).filter((l) => l.qty > 0)
    );
  }

  async function sendRequest() {
    if (!lines.length || !client || saving || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const body = {
      clientId: client.id,
      tierId: client.tierId ?? null,
      locationId: vanId,
      channel: "VAN",
      tourneeId,
      remise: 0,
      paid: 0,
      notes: notes.trim() || null,
      // No unitPrice: the server prices from the client tier at confirm.
      lines: lines.map((l) => ({ productId: l.productId, unitId: l.unitId, qty: l.qty })),
    };
    try {
      const res = await fetch("/api/sales/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setError(d?.error ?? "failed");
        return;
      }
      beepConfirm();
      setDone({ queued: false });
      setLines([]);
      setNotes("");
      setShowRecap(false);
    } catch {
      // Offline: queue the request, it syncs as a DRAFT order later.
      try {
        await queueOp("order", body as unknown as Record<string, unknown>);
      } catch {
        setError("save_failed");
        return;
      }
      beepConfirm();
      setDone({ queued: true });
      setLines([]);
      setNotes("");
      setShowRecap(false);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function startPress(p: Prod) {
    window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => {
      if (p.images.length) {
        setGallery(p);
        setGIdx(0);
      }
    }, 500);
  }
  function endPress() {
    window.clearTimeout(pressTimer.current);
  }

  return (
    <div className="space-y-3 p-4 pb-28 md:p-5 md:pb-28">
      <div className="flex items-center gap-2">
        <button
          aria-label="back"
          onClick={() => router.push(`/${locale}/livreur/${day}/dashboard${client ? `?client=${client.id}` : ""}`)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default)"
        >
          <ArrowLeft size={18} className="rtl:rotate-180" />
        </button>
        <button
          onClick={() => setScanOpen(true)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-(--brand-500) bg-(--brand-500)/5 p-2.5 text-start"
        >
          <QrCode size={17} className="shrink-0 text-(--brand-600)" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-black">{client ? client.name : labels.scanTitle}</span>
            <span className="block truncate font-mono text-[11px] opacity-60" dir="ltr">{client?.code ?? labels.scanHint}</span>
          </span>
        </button>
      </div>

      {!showRecap ? (
        <>
          <div className="flex gap-2">
            <div className="flex-1">
              <Input className="bg-white text-neutral-900 placeholder:text-neutral-400 focus:bg-white" placeholder={labels.searchProduct} value={pq} onChange={(e) => setPq(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            <button onClick={() => setCat("")} className={cn("shrink-0 rounded-full px-3 py-2 text-xs font-black", cat === "" ? "bg-(--brand-500) text-white" : "bg-(--bg-sunken) opacity-70")}>
              {labels.allCats}
            </button>
            {effCategories.map((c) => (
              <button key={c.id} onClick={() => setCat(cat === c.id ? "" : c.id)} className={cn("max-w-28 shrink-0 truncate rounded-full px-3 py-2 text-xs font-black", cat === c.id ? "bg-(--brand-500) text-white" : "bg-(--bg-sunken) opacity-70")}>
                {c.name}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {filteredProducts.map((p) => {
              const img = p.images[0]?.url;
              const pack = p.conversions.filter((c) => Number(c.factor) > 1).sort((a, b) => Number(a.factor) - Number(b.factor))[0];
              const stock = depotOf(p.id);
              const f = pack ? normFactor(Number(pack.factor)) : 0;
              const whole = f ? Math.floor(stock / f) : 0;
              const rest = f ? Math.round((stock - whole * f) * 1000) / 1000 : 0;
              return (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openQty(p)}
                  onTouchStart={() => startPress(p)}
                  onTouchEnd={endPress}
                  onTouchMove={endPress}
                  onMouseDown={() => startPress(p)}
                  onMouseUp={endPress}
                  onMouseLeave={endPress}
                  onKeyDown={(e) => e.key === "Enter" && openQty(p)}
                  className="overflow-hidden rounded-2xl border border-(--border-default) bg-(--bg-overlay)"
                >
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img} alt={p.name} className="aspect-[4/3] w-full object-cover" loading="lazy" draggable={false} />
                  ) : (
                    <div className="flex aspect-[4/3] w-full items-center justify-center bg-(--bg-sunken) text-2xl opacity-50">📦</div>
                  )}
                  <div className="space-y-1 p-2">
                    <div className="truncate text-[13px] font-bold">{p.name}</div>
                    {pack && (
                      <div className="truncate text-[11px] font-bold text-(--brand-600)">
                        1 {pack.unit.name} = <bdi>{f}</bdi> {p.baseUnit?.name ?? ""}
                      </div>
                    )}
                    <div className={cn("rounded-lg bg-(--bg-sunken) px-1.5 py-1 text-[10px] font-bold tabular-nums", stock <= 0 ? "text-red-500" : "")}>
                      <div className="flex items-baseline justify-between gap-1">
                        <span className="opacity-60">🏭 {labels.stock}{products.length === 0 && syncAge() ? ` · ${syncAge()}` : ""}</span>
                        <span><bdi>{pack ? whole : stock}</bdi> {pack ? pack.unit.name : (p.baseUnit?.name ?? "")}{pack && rest > 0 ? <> + <bdi>{rest}</bdi> {p.baseUnit?.name ?? ""}</> : null}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <div className="space-y-1.5">
            {lines.map((l, i) => {
              const p = effProducts.find((x) => x.id === l.productId);
              return (
                <div key={i} className="rounded-xl border border-(--border-default) p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1 truncate text-[13px] font-bold">{p?.name ?? l.productId.slice(-4)}</div>
                    <div className="shrink-0 text-sm font-black tabular-nums" dir="ltr">{l.qty} {p ? unitName(p, l.unitId) : ""}</div>
                  </div>
                  <div className="mt-1.5 flex items-center justify-end gap-2">
                    <div className="flex shrink-0 items-center gap-1">
                      <button aria-label="-" onClick={() => bump(i, -1)} className="flex h-10 w-10 items-center justify-center rounded-lg bg-(--bg-sunken)">
                        <Minus size={15} />
                      </button>
                      <span className="w-8 text-center text-sm font-black tabular-nums">{l.qty}</span>
                      <button aria-label="+" onClick={() => bump(i, 1)} className="flex h-10 w-10 items-center justify-center rounded-lg bg-(--bg-sunken)">
                        <Plus size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {lines.length === 0 && <p className="text-center text-sm opacity-60">{labels.empty}</p>}
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.notes}</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}
          <Button onClick={() => void sendRequest()} disabled={saving || !lines.length || !client} className="h-12 w-full text-base">
            {saving ? "…" : labels.sendRequest}
          </Button>
        </div>
      )}

      {/* Bottom arrow: products ⇄ request recap */}
      <button
        onClick={() => setShowRecap((v) => !v)}
        className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 flex items-center justify-center gap-2 border-t border-(--border-default) bg-(--bg-overlay) py-3 text-sm font-black shadow-[0_-4px_16px_rgba(0,0,0,0.08)] lg:bottom-0"
      >
        <ArrowDownUp size={17} className="text-(--brand-600)" />
        {showRecap ? labels.backToProducts : `${labels.request} · ${lines.length}`}
      </button>

      {/* Scan popup — locked: the request cannot start until the client QR
          is scanned (camera or gallery). */}
      <Modal open={scanOpen} onClose={() => setScanOpen(false)} title={labels.scanTitle} subtitle={vanName} icon={<QrCode size={18} />} locked>
        <div className="space-y-3">
          <CameraBox
            hint={labels.scanHint}
            onDetect={(t) => { onScan(t); }}
            labels={{
              scan: labels.scan ?? labels.scanTitle,
              gallery: labels.gallery ?? "gallery",
              qrNotFound: labels.qrNotFound ?? "qr_not_found",
              camNeedHttps: labels.camNeedHttps ?? "",
              camDenied: labels.camDenied ?? "",
              camUnsupported: labels.camUnsupported ?? "",
            }}
          />
          <Button variant="secondary" onClick={() => router.push(`/${locale}/livreur/${day}/dashboard`)} className="w-full">
            <ArrowLeft size={15} className="me-1 rtl:rotate-180" />
            {labels.backToDash ?? labels.backToProducts}
          </Button>
        </div>
      </Modal>

      {/* Qty popup — centered, capped to depot availability */}
      {qtyFor && (() => {
        const pack = packOf(qtyFor);
        const live = freshStock ?? depotOf(qtyFor.id);
        const avail = Math.max(0, live);
        const f = pack ? normFactor(Number(pack.factor)) : 0;
        const packs = f ? Math.floor(avail / f) : 0;
        const rest = f ? Math.round((avail - packs * f) * 1000) / 1000 : 0;
        const maxPacks = packs;
        const maxUnits = Math.floor(avail);
        const packFull = qtyPacks >= maxPacks;
        const unitFull = qtyUnits >= maxUnits;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <button type="button" aria-label={labels.cancel} onClick={() => setQtyFor(null)} className="absolute inset-0 bg-black/55" />
            <div className="relative max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-4 shadow-2xl">
              <div className="mb-1 truncate text-base font-black">{qtyFor.name}</div>
              <div className={cn("mb-2 rounded-xl bg-(--bg-sunken) p-2.5", live <= 0 ? "text-red-500" : "")}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-bold opacity-60">🏭 {labels.stock}{!depotLive && syncAge() ? ` · ${syncAge()}` : ""}</span>
                  <span className="text-base font-black tabular-nums"><bdi>{packs}</bdi> {pack ? pack.unit.name : (qtyFor.baseUnit?.name ?? "")}{pack && rest > 0 ? <> + <bdi>{rest}</bdi> {qtyFor.baseUnit?.name ?? ""}</> : null}</span>
                </div>
                {pack && (
                  <div className="mt-1 space-y-0.5 border-t border-(--border-default) pt-1 text-xs font-bold tabular-nums opacity-80">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="opacity-60">1 {pack.unit.name} =</span>
                      <span><bdi>{f}</bdi> {qtyFor.baseUnit?.name ?? ""}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="opacity-60">{labels.total}</span>
                      <span><bdi>{live}</bdi> {qtyFor.baseUnit?.name ?? ""}</span>
                    </div>
                  </div>
                )}
              </div>
              {pack && (
                <div className="mb-2 flex items-center justify-between rounded-xl bg-(--bg-sunken) p-3">
                  <div>
                    <div className="text-sm font-black">{pack.unit.name}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button aria-label="-" onClick={() => setQtyPacks((v) => Math.max(0, v - 1))} className="flex h-11 w-11 items-center justify-center rounded-xl border border-(--border-default)">
                      <Minus size={17} />
                    </button>
                    <span className="w-10 text-center text-xl font-black tabular-nums">{qtyPacks}</span>
                    <button aria-label="+" onClick={() => setQtyPacks((v) => Math.min(maxPacks, v + 1))} disabled={packFull} className="flex h-11 w-11 items-center justify-center rounded-xl border border-(--border-default) disabled:opacity-30">
                      <Plus size={17} />
                    </button>
                  </div>
                </div>
              )}
              {(!pack || allowPieces) && (
              <div className="flex items-center justify-between rounded-xl bg-(--bg-sunken) p-3">
                <div>
                  <div className="text-sm font-black">{labels.colis}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button aria-label="-" onClick={() => setQtyUnits((v) => Math.max(0, v - 1))} className="flex h-11 w-11 items-center justify-center rounded-xl border border-(--border-default)">
                    <Minus size={17} />
                  </button>
                  <span className="w-10 text-center text-xl font-black tabular-nums">{qtyUnits}</span>
                  <button aria-label="+" onClick={() => setQtyUnits((v) => Math.min(maxUnits, v + 1))} disabled={unitFull} className="flex h-11 w-11 items-center justify-center rounded-xl border border-(--border-default) disabled:opacity-30">
                    <Plus size={17} />
                  </button>
                </div>
              </div>
              )}
              <div className="mt-3 flex gap-2">
                <Button variant="secondary" onClick={() => setQtyFor(null)} className="flex-1">{labels.cancel}</Button>
                <Button onClick={addQty} disabled={qtyPacks <= 0 && qtyUnits <= 0} className="flex-[2]">{labels.confirm}</Button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Image gallery (long-press, swipe) */}
      <Modal open={gallery !== null} onClose={() => setGallery(null)} title={gallery?.name ?? ""} subtitle="" icon="🖼">
        {gallery && (
          <div
            onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
            onTouchEnd={(e) => {
              if (touchX.current == null) return;
              const dx = e.changedTouches[0].clientX - touchX.current;
              if (Math.abs(dx) > 40) {
                setGIdx((i) => (dx < 0 ? Math.min(gallery.images.length - 1, i + 1) : Math.max(0, i - 1)));
              }
              touchX.current = null;
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={gallery.images[gIdx]?.url} alt={gallery.name} className="max-h-[60vh] w-full rounded-xl object-contain" />
            {gallery.images.length > 1 && (
              <div className="mt-2 flex items-center justify-center gap-1.5">
                <button aria-label="prev" onClick={() => setGIdx((i) => Math.max(0, i - 1))} className="rounded-lg bg-(--bg-sunken) px-3 py-2 font-black">‹</button>
                {gallery.images.map((_, i) => (
                  <span key={i} className={cn("h-1.5 w-1.5 rounded-full", i === gIdx ? "bg-(--brand-500)" : "bg-(--border-default)")} />
                ))}
                <button aria-label="next" onClick={() => setGIdx((i) => Math.min(gallery.images.length - 1, i + 1))} className="rounded-lg bg-(--bg-sunken) px-3 py-2 font-black">›</button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Done → back to work */}
      <Modal open={done !== null} onClose={() => setDone(null)} title={labels.saved} subtitle="" icon={<ClipboardList size={18} />}>
        <p className="text-xs font-bold opacity-60">{done?.queued ? labels.orderQueued : labels.orderSaved}</p>
        <div className="mt-2 flex gap-2">
          <Button variant="secondary" onClick={() => setDone(null)} className="flex-1">{labels.request}</Button>
          <Button onClick={() => router.push(`/${locale}/livreur/${day}/commandes`)} className="flex-[2]">{labels.commandes}</Button>
        </div>
      </Modal>
    </div>
  );
}
