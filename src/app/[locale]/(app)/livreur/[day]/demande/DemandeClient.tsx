"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownUp, ArrowLeft, Minus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { normFactor, packBreakdown } from "@/components/products/UnitQty";
import { queueOp, getOutbox, updateOutboxPayload, syncNow, goPage, queueErrText } from "@/lib/sync/client";
import type { OutboxRow } from "@/lib/sync/offline-db";
import { beepAdd, beepConfirm } from "@/lib/beep";
import { cn } from "@/lib/utils";

import { ErrText } from "@/components/ui/ErrText";
type Prod = {
  id: string; name: string; reference: string | null;
  baseUnitId: string | null;
  baseUnit: { id: string; name: string } | null;
  images: Array<{ url: string }>;
  conversions: Array<{ unitId: string; factor: unknown; unit: { name: string } }>;
  category: { id: string; name: string } | null;
};
type Line = { productId: string; qty: number };
type ServerLine = {
  id: string; productId: string; declaredQty: unknown; confirmedQty: unknown;
  product: { id: string; name: string; baseUnit?: { id: string; name: string } | null; conversions?: Array<{ unitId: string; factor: unknown; unit: { name: string } }> } | null;
};
type SyncedReq = {
  id: string; number: string; status: string; date: unknown; notes: string | null;
  fromLocation: { name: string } | null;
  lines: ServerLine[];
};
type PendingReq = { opId: string; ts: number; depotId: string; notes: string | null; lines: Array<{ productId: string; qty: number }> };

const DEPOT_KEY = "dili_restock_depot_v1";

/// Livreur "طلب بضاعة" — restock request for the VAN (not a client order).
/// Products against DEPOT stock → each send queues a depot→van
/// `transfer-declare` (fully offline; staff APIs stay 403 by design).
/// Requests list merges synced DECLARED transfers + queued ones, with
/// modify (pending: rewrite in place; synced: reject + redeclare) and
/// delete. Admin validates in vans/orders — validation confirms
/// immediately, no van-side confirmation step.
export function DemandeClient({
  locale,
  day,
  vanId,
  vanName,
  products,
  categories,
  depots,
  depotStocks,
  initialRequests,
  allowPieces,
  labels,
}: {
  locale: string;
  day: string;
  vanId: string;
  vanName: string;
  products: Prod[];
  categories: Array<{ id: string; name: string }>;
  depots: Array<{ id: string; name: string }>;
  depotStocks: Record<string, Record<string, number>>;
  initialRequests: SyncedReq[];
  allowPieces: boolean;
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [cat, setCat] = useState("");
  const [pq, setPq] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [showRecap, setShowRecap] = useState(false);
  const [notes, setNotes] = useState("");
  const [qtyFor, setQtyFor] = useState<Prod | null>(null);
  const [qtyPacks, setQtyPacks] = useState(1);
  const [qtyUnits, setQtyUnits] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [depotId, setDepotId] = useState<string>(depots[0]?.id ?? "");
  /// Editing target: rewriting a previous request instead of a fresh one.
  const [editing, setEditing] = useState<{ kind: "pending"; opId: string } | { kind: "synced"; id: string } | null>(null);
  const [pendingReqs, setPendingReqs] = useState<PendingReq[]>([]);
  const [rows, setRows] = useState<SyncedReq[]>(initialRequests);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [queuedOut, setQueuedOut] = useState<OutboxRow[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(DEPOT_KEY);
      if (saved && depots.some((d) => d.id === saved)) setDepotId(saved);
    } catch { /* ignore */ }
    void reloadPending();
    getOutbox().then(setQueuedOut).catch(() => {});
    try {
      void import("@/lib/sync/client").then((m) => m.prefetchPages([window.location.href])).catch(() => {});
    } catch { /* never break the page */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickDepot(id: string) {
    setDepotId(id);
    try {
      localStorage.setItem(DEPOT_KEY, id);
    } catch { /* ignore */ }
  }

  async function reloadPending() {
    try {
      const ops = await getOutbox();
      const out: PendingReq[] = [];
      for (const o of ops) {
        if (o.kind !== "transfer-declare" || o.error) continue;
        const p = o.payload as Record<string, unknown>;
        const raw = Array.isArray(p.lines) ? (p.lines as Array<Record<string, unknown>>) : [];
        out.push({
          opId: o.opId,
          ts: o.ts,
          depotId: typeof p.fromLocationId === "string" ? p.fromLocationId : "",
          notes: typeof p.notes === "string" ? p.notes : null,
          lines: raw
            .map((l) => ({ productId: String(l.productId ?? ""), qty: Number(l.qty ?? 0) }))
            .filter((l) => l.productId && l.qty > 0),
        });
      }
      setPendingReqs(out.sort((a, b) => b.ts - a.ts));
    } catch { /* ignore */ }
  }

  const prodName = (pid: string) => products.find((p) => p.id === pid)?.name ?? pid.slice(-4);
  /// Depot stock for the selected depot (SSR map — present in the cached
  /// page offline too), minus what this phone already queued. Snapshot
  /// depotStock is company-global (not per-depot), so it can't split here.
  const depotOf = (pid: string): number => depotStocks[depotId]?.[pid] ?? 0;
  const queuedFor = (pid: string): number => {
    let n = 0;
    for (const o of queuedOut) {
      if (o.kind !== "transfer-declare" || o.error) continue;
      const p = o.payload as Record<string, unknown>;
      if (p.fromLocationId !== depotId) continue;
      for (const l of (Array.isArray(p.lines) ? p.lines : []) as Array<Record<string, unknown>>) {
        if (String(l.productId) === pid) n += Number(l.qty ?? 0);
      }
    }
    return n;
  };
  const availOf = (pid: string) => Math.max(0, depotOf(pid) - queuedFor(pid));

  /// Colisage display (like the rest of the app): base qty broken down
  /// through pack levels ("5 كرتون + 2 قطعة"), falling back to the raw
  /// base qty when the product has no packs. All transfer quantities are
  /// stored in base units — this is display-only.
  const prodOf = (pid: string) => products.find((p) => p.id === pid);
  function colisText(pid: string, qty: number, fallback?: ServerLine["product"]): string {
    const p = prodOf(pid) as
      | { baseUnit?: { name: string } | null; conversions?: Array<{ unitId: string; factor: unknown; unit: { name: string } }> }
      | undefined;
    const convs = (p?.conversions ?? fallback?.conversions ?? []).map((c) => ({ unitId: c.unitId, factor: Number(c.factor) }));
    if (!convs.some((c) => c.factor > 1)) return String(qty);
    const src = p?.conversions ?? fallback?.conversions ?? [];
    const uname = (id: string) => src.find((c) => c.unitId === id)?.unit.name ?? "";
    const base = p?.baseUnit?.name ?? (fallback as { baseUnit?: { name: string } } | null)?.baseUnit?.name ?? "";
    return packBreakdown(qty, convs, uname, base);
  }

  const filteredProducts = products.filter(
    (p) =>
      (!cat || p.category?.id === cat) &&
      (!pq || p.name.includes(pq) || (p.reference ?? "").includes(pq))
  );

  function packOf(p: Prod) {
    return p.conversions
      .filter((c) => Number(c.factor) > 1)
      .sort((a, b) => Number(a.factor) - Number(b.factor))[0];
  }

  function openQty(p: Prod) {
    setQtyFor(p);
    const hasPack = p.conversions.some((c) => Number(c.factor) > 1);
    setQtyPacks(hasPack ? 1 : 0);
    setQtyUnits(hasPack ? 0 : 1);
  }

  function addQty() {
    if (!qtyFor) return;
    const p = qtyFor;
    const pack = packOf(p);
    const f = pack ? normFactor(Number((pack as { factor: unknown }).factor)) : 0;
    // Editing a line already in the composer: its qty goes back to the pool.
    const cur = lines.find((l) => l.productId === p.id);
    const curBase = cur ? Number(cur.qty) : 0;
    const avail = Math.max(0, availOf(p.id) + curBase);
    const packs = f ? Math.min(qtyPacks, Math.floor(avail / f)) : 0;
    const units = Math.min(qtyUnits, Math.floor(avail));
    // Base units, whole packs when pieces are off (mirrors the server rule).
    const qty = (pack ? packs * f : 0) + (!pack || allowPieces ? units : 0);
    if (!(qty > 0)) {
      closeQty();
      return;
    }
    setLines((prev) => {
      const rest = prev.filter((l) => l.productId !== p.id);
      return [...rest, { productId: p.id, qty: Math.round(qty * 1000) / 1000 }];
    });
    beepAdd();
    closeQty();
  }

  function closeQty() {
    setQtyFor(null);
  }

  function bump(i: number, d: number) {
    // Recap +/- is capped by depot availability (the line's own qty goes
    // back to the pool) so an oversized request can't be built by tapping
    // + — the server would reject it at sync with a raw error instead.
    setLines((prev) => {
      const l = prev[i];
      if (!l) return prev;
      const cap = availOf(l.productId) + Number(l.qty);
      const next = Math.max(0, Math.min(cap, Math.round((l.qty + d) * 1000) / 1000));
      return prev
        .map((x, j) => (j === i ? { ...x, qty: next } : x))
        .filter((x) => x.qty > 0);
    });
  }

  /// Modify: load the request back into the composer. The old one is
  /// replaced on send (pending: rewritten in place; synced: rejected).
  function startModify(kind: "pending" | "synced", id: string, reqLines: Array<{ productId: string; qty: number }>) {
    setLines(reqLines.map((l) => ({ productId: l.productId, qty: l.qty })));
    setEditing(kind === "pending" ? { kind, opId: id } : { kind, id });
    setShowRecap(true);
    setError(null);
    setNotice(null);
    window.scrollTo({ top: 0 });
  }
  function cancelModify() {
    setEditing(null);
    setLines([]);
    setNotes("");
    setShowRecap(false);
  }

  async function sendRequest() {
    if (!lines.length || !depotId || saving || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setNotice(null);
    const body = {
      fromLocationId: depotId,
      toLocationId: vanId,
      notes: notes.trim() || null,
      lines: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
    };
    try {
      // Retire the request being rewritten, then declare the new one.
      if (editing?.kind === "pending") {
        await updateOutboxPayload(editing.opId, body as unknown as Record<string, unknown>);
      } else {
        if (editing?.kind === "synced") {
          await queueOp("transfer-reject", { transferId: editing.id, action: "cancel" });
        }
        await queueOp("transfer-declare", body as unknown as Record<string, unknown>);
      }
      setEditing(null);
      setLines([]);
      setNotes("");
      setShowRecap(false);
      beepConfirm();
      setNotice(labels.queuedOk ?? "queued");
      await reloadPending();
      setQueuedOut(await getOutbox().catch(() => []));
      // Online: flush immediately so the depot sees it in seconds. The row
      // appears in the synced list on the next visit (full document load).
      try {
        if (typeof navigator === "undefined" || navigator.onLine !== false) {
          await syncNow();
          await reloadPending();
        }
      } catch {
        /* stays queued for the next sync */
      }
    } catch (e) {
      setError(queueErrText(labels, e));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function dropRequest(kind: "pending" | "synced", id: string) {
    if (saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (kind === "pending") {
        const { discardOutboxOp } = await import("@/lib/sync/client");
        await discardOutboxOp(id);
        await reloadPending();
        setNotice(labels.discarded ?? "deleted ✓");
      } else {
        await queueOp("transfer-reject", { transferId: id, action: "cancel" });
        setRows((prev) => prev.filter((r) => r.id !== id));
        setNotice(labels.queuedOk ?? "queued");
        try {
          if (typeof navigator === "undefined" || navigator.onLine !== false) {
            await syncNow();
          }
        } catch {
          /* stays queued */
        }
      }
    } catch (e) {
      setError(queueErrText(labels, e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 p-4 pb-28 md:p-5 md:pb-28">
      <div className="flex items-center gap-2">
        <button
          aria-label="back"
          onClick={() => goPage(router, `/${locale}/livreur/${day}/dashboard`)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default)"
        >
          <ArrowLeft size={18} className="rtl:rotate-180" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-black">{labels.restock}</h1>
          <p className="truncate text-xs opacity-60">{vanName}</p>
        </div>
      </div>
      <p className="text-xs font-bold opacity-60">{labels.restockHint}</p>
      {depots.length === 0 && (
        <p className="rounded-xl bg-amber-500/10 p-2.5 text-xs font-bold text-amber-600">{labels.empty}</p>
      )}
      {depots.length > 1 && (
        <div>
          <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.depot}</label>
          <select
            value={depotId}
            onChange={(e) => pickDepot(e.target.value)}
            className="h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm outline-none focus:border-(--brand-500)"
          >
            {depots.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
      )}
      {editing && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-black text-amber-600">
          <span>✎ {labels.modify}</span>
          <button type="button" onClick={cancelModify} className="rounded-lg bg-(--bg-overlay) px-3 py-1.5">{labels.cancel}</button>
        </div>
      )}

      {!showRecap ? (
        <>
          <div className="flex gap-2">
            <div className="flex-1">
              <Input placeholder={labels.searchProduct} value={pq} onChange={(e) => setPq(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            <button onClick={() => setCat("")} className={cn("min-h-11 shrink-0 rounded-full px-3 py-2 text-xs font-black", cat === "" ? "bg-(--brand-500) text-(--brand-contrast)" : "bg-(--bg-sunken) opacity-70")}>
              {labels.allCats}
            </button>
            {categories.map((c) => (
              <button key={c.id} onClick={() => setCat(cat === c.id ? "" : c.id)} className={cn("min-h-11 max-w-28 shrink-0 truncate rounded-full px-3 py-2 text-xs font-black", cat === c.id ? "bg-(--brand-500) text-(--brand-contrast)" : "bg-(--bg-sunken) opacity-70")}>
                {c.name}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {filteredProducts.map((p) => {
              const avail = availOf(p.id);
              const inReq = lines.find((l) => l.productId === p.id);
              return (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => avail > 0 && openQty(p)}
                  onKeyDown={(e) => e.key === "Enter" && avail > 0 && openQty(p)}
                  className={cn("relative overflow-hidden rounded-2xl border border-(--border-default) bg-(--bg-overlay)", avail <= 0 && "opacity-50")}
                >
                  {inReq && (
                    <span className="absolute end-1.5 top-1.5 z-10 rounded-full bg-(--brand-500) px-2 py-0.5 text-[11px] font-black tabular-nums text-(--brand-contrast)" dir="ltr">
                      {colisText(p.id, inReq.qty)}
                    </span>
                  )}
                  <div className="p-2.5">
                    <div className="truncate text-[13px] font-bold">{p.name}</div>
                    <div className="mt-0.5 text-[11px] font-black tabular-nums text-(--brand-600)" dir="ltr">
                      {labels.stockDepot ?? ""}: {colisText(p.id, avail)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <button
            onClick={() => setShowRecap(true)}
            disabled={!lines.length}
            className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 flex items-center justify-center gap-2 border-t border-(--border-default) bg-(--bg-overlay) py-3 text-sm font-black shadow-[0_-4px_16px_rgba(0,0,0,0.08)] disabled:opacity-50 lg:bottom-0"
            data-testid="restock-recap"
          >
            <ArrowDownUp size={17} className="text-(--brand-600)" />
            {labels.myRequests} · {lines.length}
          </button>
        </>
      ) : (
        <div className="space-y-2">
          <div className="space-y-1.5">
            {lines.map((l, i) => (
              <div key={i} className="rounded-xl border border-(--border-default) p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1 truncate text-[13px] font-bold">{prodName(l.productId)}</div>
                  <div className="shrink-0 text-sm font-black tabular-nums" dir="ltr">{colisText(l.productId, l.qty)}</div>
                </div>
                <div className="mt-1.5 flex items-center justify-end gap-2">
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label={labels.remove ?? "Remove"}
                      title={labels.remove ?? "Remove"}
                      onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                      className="flex h-10 w-10 items-center justify-center rounded-lg text-red-500 hover:bg-red-500/10"
                    >
                      <Trash2 size={15} />
                    </button>
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
            ))}
            {lines.length === 0 && <p className="text-center text-sm opacity-60">{labels.empty}</p>}
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.notes}</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </div>
          {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}
          {notice && <p className="rounded-xl bg-emerald-500/10 p-2.5 text-xs font-bold text-emerald-600">{notice}</p>}
          <Button onClick={() => void sendRequest()} disabled={saving || !lines.length || !depotId} data-testid="send-restock" className="h-12 w-full text-base">
            {saving ? "…" : labels.confirm}
          </Button>
        </div>
      )}

      {qtyFor && (() => {
        const pack = packOf(qtyFor);
        const f = pack ? normFactor(Number((pack as { factor: unknown }).factor)) : 0;
        const avail = availOf(qtyFor.id);
        const maxPacks = f ? Math.floor(avail / f) : 0;
        const maxUnits = Math.floor(avail);
        const packFull = f ? qtyPacks >= maxPacks : true;
        const unitFull = qtyUnits >= maxUnits;
        return (
          <Modal open onClose={closeQty} title={qtyFor.name} subtitle={`${labels.stockDepot ?? ""}: ${colisText(qtyFor.id, avail)}`} icon="📦" width="sm">
            <div className="space-y-2">
              {pack && (
                <div className="flex items-center justify-between rounded-xl bg-(--bg-sunken) p-3">
                  <div>
                    <div className="text-sm font-black">{(pack as { unit: { name: string } }).unit.name}</div>
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
                    <div className="text-sm font-black">{qtyFor.baseUnit?.name ?? labels.qty}</div>
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
              <div className="flex gap-2">
                <Button variant="secondary" onClick={closeQty} className="flex-1">{labels.cancel}</Button>
                <Button onClick={addQty} disabled={qtyPacks <= 0 && qtyUnits <= 0} data-testid="qty-confirm" className="flex-[2]">{labels.confirm}</Button>
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* My requests: synced (status) + queued (⏳) — modify/delete. */}
      <div className="space-y-1.5 pt-2">
        <h2 className="text-sm font-black opacity-60">{labels.myRequests} ({rows.length + pendingReqs.length})</h2>
        {pendingReqs.map((r) => (
          <div key={r.opId} className="rounded-xl border border-amber-500/40 bg-(--bg-overlay) p-2.5">
            <div className="flex items-center justify-between gap-2 text-sm font-black">
              <span>… · {depots.find((d) => d.id === r.depotId)?.name ?? ""}</span>
              <span className="rounded-full bg-amber-500/10 px-1.5 py-px text-[10px] text-amber-600">⏳</span>
            </div>
            <div className="mt-1 space-y-0.5">
              {r.lines.map((l, i) => (
                <div key={i} className="flex justify-between gap-2 text-xs tabular-nums">
                  <span className="truncate">{prodName(l.productId)}</span>
                  <span className="shrink-0 font-bold" dir="ltr">{colisText(l.productId, l.qty)}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <Button variant="secondary" onClick={() => startModify("pending", r.opId, r.lines)} className="flex-1">{labels.modify}</Button>
              <Button variant="secondary" onClick={() => { setConfirming(`pending:${r.opId}`); }} className="flex-1 opacity-70" aria-label="delete">
                <Trash2 size={15} />
              </Button>
            </div>
          </div>
        ))}
        {rows.map((r) => (
          <div key={r.id} className="rounded-xl border border-(--border-default) bg-(--bg-overlay) p-2.5">
            <div className="flex items-center justify-between gap-2 text-sm font-black">
              <span>{r.number} · {r.fromLocation?.name ?? ""}</span>
              <span className={cn(
                "rounded-full px-1.5 py-px text-[10px]",
                r.status === "DECLARED" ? "bg-amber-500/10 text-amber-600" : r.status === "CONFIRMED" ? "bg-emerald-500/15 text-emerald-600" : "bg-(--bg-sunken) opacity-60"
              )}>
                {r.status}
              </span>
            </div>
            <div className="mt-1 space-y-0.5">
              {r.lines.map((l) => (
                <div key={l.id} className="flex justify-between gap-2 text-xs tabular-nums">
                  <span className="truncate">{l.product?.name ?? ""}</span>
                  <span className="shrink-0 font-bold" dir="ltr">{colisText(l.productId, Number(l.declaredQty ?? 0), l.product)}</span>
                </div>
              ))}
            </div>
            {r.status === "DECLARED" && (
              <div className="mt-2 flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => startModify("synced", r.id, r.lines.map((l) => ({ productId: l.productId, qty: Number(l.declaredQty ?? 0) })))}
                  className="flex-1"
                >
                  {labels.modify}
                </Button>
                <Button variant="secondary" onClick={() => { setConfirming(r.id); }} className="flex-1 opacity-70" aria-label="delete">
                  <Trash2 size={15} />
                </Button>
              </div>
            )}
          </div>
        ))}
        {rows.length + pendingReqs.length === 0 && <p className="text-center text-sm opacity-60">{labels.empty}</p>}
      </div>

      <Modal open={confirming !== null} onClose={() => setConfirming(null)} title={labels.cancel} icon={<Trash2 size={18} />} width="sm">
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setConfirming(null)} className="flex-1">{labels.cancel}</Button>
          <Button
            onClick={() => {
              const id = confirming;
              setConfirming(null);
              if (id) void dropRequest(id.startsWith("pending:") ? "pending" : "synced", id.startsWith("pending:") ? id.slice("pending:".length) : id);
            }}
            className="flex-1"
          >
            {labels.confirm}
          </Button>
        </div>
      </Modal>
      {notice && <p className="rounded-xl bg-emerald-500/10 p-2.5 text-xs font-bold text-emerald-600">{notice}</p>}
      {error && !showRecap && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}
    </div>
  );
}
