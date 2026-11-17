"use client";

import { Fragment, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ArrowLeft, ClipboardList, Printer, RotateCcw, Share2, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { UnsyncedBadge } from "@/components/sync/UnsyncedBadge";
import { TicketView, type TicketLabels, type TicketVM } from "@/components/sales/TicketView";
import { queueOp, goPage, getUnsyncedDocKeys, getPendingDocs, discardOutboxOp, queueErrText, saveCachedDetail, getCachedDetail, type PendingDoc } from "@/lib/sync/client";
import { canSell } from "@/lib/staff-permissions";
import { PdfViewer } from "@/components/sales/PdfViewer";
import { printTicketNative } from "@/lib/print-ticket";

import { dz, dzMoney, fmtDT } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSyncedState } from "@/lib/data-sync";

import { ErrText } from "@/components/ui/ErrText";
type Row = {
  id: string; number: string; status: string; total: unknown; paid: unknown; date: unknown;
  client: { id: string; name: string; code: string } | null;
  _count: { lines: number };
};

type Detail = {
  id: string; number: string; status: string;
  total: unknown; paid: unknown;
  date: unknown;
  client: { id: string; name: string; code: string; phone: string | null } | null;
  location: { id: string; name: string } | null;
  lines: Array<{
    id: string; qty: unknown; baseQty: unknown; unitPrice: unknown; lineTotal: unknown;
    product: {
      name: string;
      images?: Array<{ url: string }>;
      conversions?: Array<{ unitId: string; factor: unknown; unit: { name: string } }>;
    } | null;
  }>;
};

/// Livreur commandes: his van's open orders. Tapping a card opens its
/// detail form right here (lines, client, totals + sell/deliver actions) —
/// never a redirect, never the admin sales page (blocked for staff).
/// CONFIRMED (ready) orders also get an inline deliver button.
export function VanOrdersClient({
  locale,
  day,
  vanId,
  role,
  rows: initial,
  doneRows: initialDone,
  labels,
  ticketLabels,
  ticketLang,
}: {
  locale: string;
  day: string;
  vanId: string;
  role: string;
  rows: Row[];
  doneRows: Row[];
  labels: Record<string, string>;
  ticketLabels: TicketLabels;
  ticketLang: "ar" | "fr";
}) {
  const router = useRouter();
  const [rows, setRows] = useSyncedState(initial);
  const [doneRows, setDoneRows] = useSyncedState(initialDone);
  const [reopenArmed, setReopenArmed] = useState<string | null>(null);
  const [delivering, setDelivering] = useState<Row | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [paid, setPaid] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokeArmed, setRevokeArmed] = useState(false);
  /// Ops queued while offline (deliver/cancel): badged until synced —
  /// hydrated from the outbox on mount so previous sessions count too.
  const [queuedIds, setQueuedIds] = useState<string[]>([]);
  /// Orders created offline (still in the outbox): visible immediately,
  /// openable/printable/shareable; delivering waits for the sync (the engine
  /// can only deliver a server-side id), cancelling drops the queued op.
  const [pending, setPending] = useState<PendingDoc[]>([]);
  useEffect(() => {
    let on = true;
    const load = () => {
      getUnsyncedDocKeys().then((s) => {
        if (on) setQueuedIds((prev) => [...new Set([...prev, ...s])]);
      }).catch(() => {});
      getPendingDocs().then((d) => {
        if (on) setPending(d.filter((x) => x.kind === "order"));
      }).catch(() => {});
    };
    load();
    window.addEventListener("online", load);
    window.addEventListener("focus", load);
    return () => {
      on = false;
      window.removeEventListener("online", load);
      window.removeEventListener("focus", load);
    };
  }, []);
  const [notice, setNotice] = useState<string | null>(null);

  async function openDetail(r: Row) {
    setRevokeArmed(false);
    setError(null);
    // Offline-created order: open from the outbox payload, no server needed.
    // Prices are set by the server at sync — quantities are what matters here.
    if (r.id.startsWith("pending:")) {
      const doc = pending.find((x) => `pending:${x.opId}` === r.id);
      if (doc) {
        setDetail({
          id: `pending:${doc.opId}`,
          number: "…",
          status: "DRAFT",
          total: null,
          paid: doc.paid,
          date: new Date(doc.ts).toISOString(),
          client: doc.clientId
            ? { id: doc.clientId, name: doc.clientName ?? "…", code: doc.clientCode ?? "", phone: doc.clientPhone }
            : null,
          location: null,
          lines: doc.lines.map((l, i) => ({
            id: `pending:${doc.opId}:${i}`,
            qty: l.qty,
            baseQty: null,
            unitPrice: 0,
            lineTotal: 0,
            product: { name: l.name },
          })),
        });
        setPaid(String(doc.paid ?? 0));
        return;
      }
    }
    try {
      const res = await fetch(`/api/sales/${r.id}`, { cache: "no-store" });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.id) {
        setDetail(d);
        setPaid(String(Number(d.total ?? 0)));
        void saveCachedDetail(r.id, d);
      } else {
        setError(d?.error ?? "failed");
      }
    } catch {
      // Offline: serve the last online copy when there is one (stale
      // banner) — deliver/print resolve against the real server id.
      const cached = getCachedDetail<Detail>(r.id);
      if (cached) {
        setDetail(cached);
        setPaid(String(Number((cached as { total?: unknown }).total ?? 0)));
        setNotice(labels.staleData ?? null);
        return;
      }
      setError(labels.offline ?? "offline");
    }
  }

  function packOfLine(l: Detail["lines"][number]): number {
    const q = Number(l.qty);
    const b = Number((l as { baseQty?: unknown }).baseQty ?? 0);
    if (!q || !b) return 1;
    const f = Math.round((b / q) * 1000) / 1000;
    return f > 1 ? f : 1;
  }

  const [printing, setPrinting] = useState(false);
  const [ticketCo, setTicketCo] = useState<{ company: { name: string; phone?: string | null; address?: string | null; rc?: string | null; nif?: string | null; logoUrl?: string | null }; width: "58" | "80"; currency: string } | null>(null);
  const [ticketQr, setTicketQr] = useState<string | null>(null);
  /// Share feedback inside the print preview (clipboard fallback notice).
  const [sharedMsg, setSharedMsg] = useState<string | null>(null);

  async function openPrint(from?: Detail | null) {
    const src = from ?? detail;
    if (!src) return;
    setPrinting(true);
    setSharedMsg(null);
    try {
      const res = await fetch("/api/settings/public", { cache: "no-store" });
      const d = await res.json().catch(() => null);
      if (d) {
        setTicketCo({
          company: d.company ?? { name: "" },
          width: d.ticketWidth === "58" ? "58" : "80",
          currency: d.currency ?? "DZD",
        });
      }
    } catch { /* offline: preview without header */ }
    // Queued docs have no server number yet — skip the QR, not the print.
    if (src.number === "…") {
      setTicketQr(null);
      return;
    }
    try {
      const { default: QRCode } = await import("qrcode");
      const url = await QRCode.toDataURL(
        JSON.stringify({ app: "distribuili", type: "order", n: src.number }),
        { margin: 1, width: 160 }
      );
      setTicketQr(url);
    } catch { /* no QR */ }
  }

  function printTicket(from?: Detail | null): TicketVM | null {
    const src = from ?? detail;
    if (!src) return null;
    return {
      number: src.number,
      date: String(src.date ?? new Date().toISOString()),
      total: src.total as number | string,
      paid: Number((src as { paid?: unknown }).paid ?? 0),
      remise: 0,
      oldDebt: null,
      newDebt: null,
      client: src.client ? { name: src.client.name, code: src.client.code, phone: src.client.phone, tierName: null } : null,
      location: src.location ? { name: src.location.name } : null,
      seller: null,
      sellerPhone: null,
      lines: src.lines.map((l) => ({
        name: l.product?.name ?? "",
        qty: l.qty as number | string,
        baseQty: (l as { baseQty?: unknown }).baseQty as number | string | null,
        unitPrice: (l as { unitPrice?: unknown }).unitPrice as number | string,
        lineTotal: (l as { lineTotal?: unknown }).lineTotal as number | string,
      })),
    };
  }

  async function doPrint() {
    // Native APK first: system print dialog with printer selection
    // (window.print() is a no-op inside the WebView).
    const t = printTicket();
    if (t) {
      const res = await printTicketNative({
        ticket: t,
        company: { name: ticketCo?.company.name ?? "", phone: ticketCo?.company.phone ?? null, address: ticketCo?.company.address ?? null, rc: ticketCo?.company.rc ?? null, nif: ticketCo?.company.nif ?? null, logoUrl: ticketCo?.company.logoUrl ?? null },
        width: ticketCo?.width ?? "80",
        labels: ticketLabels,
        lang: ticketLang,
        qrDataUrl: ticketQr,
      });
      if (res.ok) return;
      // APK but the dialog didn't open (old shell, no print service…):
      // window.print below is a no-op there — say so loudly (with the
      // reason) instead of a dead button.
      try {
        const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
        if (cap?.isNativePlatform?.()) {
          setSharedMsg(`${ticketLabels.printFail ?? "print failed"} (${res.reason})`);
          return;
        }
      } catch { /* fall through to window.print */ }
    }
    document.body.classList.add("ticket-printing");
    const done = () => document.body.classList.remove("ticket-printing");
    window.addEventListener("afterprint", done, { once: true });
    window.setTimeout(done, 2500);
    window.print();
  }

  /// Share opens the in-app PDF viewer (A4 sheet, offline): the driver
  /// sees the facture, then shares/saves the real PDF from inside it.
  const [pdfView, setPdfView] = useState(false);


  function openDeliver(r: Row) {
    setDelivering(r);
    // Prefill the FULL amount. What is typed means "total collected so far"
    // (converted to extra below) — never prefill 0 on a prepaid order.
    setPaid(String(Number(r.total ?? 0)));
    setError(null);
  }

  /// Extra payment implied by the typed total-collected, clamped at zero so
  /// re-confirming a prepaid order can never trip the overpaid guard.
  function extraFor(total: unknown, alreadyPaid: unknown, typed: string): number {
    if (typed === "") return 0;
    return Math.max(0, Number(typed) - Number(alreadyPaid ?? 0));
  }

  async function confirmDeliver() {
    if (!delivering || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const extra = extraFor(delivering.total, delivering.paid, paid);
    try {
      const res = await fetch(`/api/sales/${delivering.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deliver", locationId: vanId, paid: extra }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setError(d?.error ?? "failed");
        return;
      }
      const doneId = delivering.id;
      setDelivering(null);
      setRows((prev) => prev.filter((x) => x.id !== doneId));
      router.refresh();
      // Sale-like workflow: show the facture popup right after delivering.
      try {
        const r2 = await fetch(`/api/sales/${doneId}`, { cache: "no-store" });
        const d2 = await r2.json().catch(() => null);
        if (r2.ok && d2?.id) {
          setDetail(d2);
          setPaid(String(Number(d2.total ?? 0)));
          await openPrint(d2);
        }
      } catch { /* list already updated */ }
    } catch {
      // Offline: queue the delivery (+ cash), move it to done locally.
      try {
        await queueOp("order-deliver", { saleId: delivering.id, locationId: vanId, paid: extra });
        const doneId = delivering.id;
        setDelivering(null);
        setRows((prev) => prev.filter((x) => x.id !== doneId));
        setQueuedIds((prev) => (prev.includes(doneId) ? prev : [...prev, doneId]));
        setNotice(labels.queuedOk ?? "queued");
      } catch (e) {
        setError(queueErrText(labels, e));
      }
    } finally {
      setBusy(false);
    }
  }

  async function revokeOrder() {
    if (!detail || busy) return;
    // Role gate (buttons already hide this): Vendeur may only discard his
    // own pending orders, never cancel synced docs.
    if (!canSell(role) && !detail.id.startsWith("pending:")) return;
    if (!revokeArmed) {
      setRevokeArmed(true);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    // Offline-created order: no server row exists — drop the queued op
    // instead of queueing a cancellation the engine couldn't resolve.
    if (detail.id.startsWith("pending:")) {
      try {
        await discardOutboxOp(detail.id.slice("pending:".length));
        const goneId = detail.id;
        setDetail(null);
        setRevokeArmed(false);
        setPending((prev) => prev.filter((x) => `pending:${x.opId}` !== goneId));
        setNotice(labels.discarded ?? "deleted ✓");
      } catch {
        setError(labels.offline ?? "offline");
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      const res = await fetch(`/api/sales/${detail.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setError(d?.error ?? "failed");
        return;
      }
      const goneId = detail.id;
      setDetail(null);
      setRevokeArmed(false);
      setRows((prev) => prev.filter((x) => x.id !== goneId));
      router.refresh();
    } catch {
      // Offline: queue the cancellation.
      try {
        await queueOp("sale-cancel", { saleId: detail.id });
        const goneId = detail.id;
        setDetail(null);
        setRevokeArmed(false);
        setRows((prev) => prev.filter((x) => x.id !== goneId));
        setQueuedIds((prev) => (prev.includes(goneId) ? prev : [...prev, goneId]));
        setNotice(labels.queuedOk ?? "queued");
      } catch (e) {
        setError(queueErrText(labels, e));
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeliverDetail() {
    if (!detail || busy) return;
    // Offline-created order: delivering needs the server-side id, which only
    // exists after the next sync — say so instead of queueing a dead op.
    if (detail.id.startsWith("pending:")) {
      setNotice(labels.syncFirst ?? "sync first");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const extra = extraFor(detail.total, (detail as { paid?: unknown }).paid, paid);
    try {
      const res = await fetch(`/api/sales/${detail.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "deliver",
          locationId: vanId,
          paid: extra,
        }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setError(d?.error ?? "failed");
        return;
      }
      setRows((prev) => prev.filter((x) => x.id !== detail.id));
      // Refresh detail with the posted payment, then show the facture popup.
      try {
        const r2 = await fetch(`/api/sales/${detail.id}`, { cache: "no-store" });
        const d2 = await r2.json().catch(() => null);
        if (r2.ok && d2?.id) {
          setDetail(d2);
          await openPrint(d2);
          router.refresh();
          return;
        }
      } catch { /* keep current detail */ }
      await openPrint();
    } catch {
      // Offline: queue the delivery (+ cash), no facture popup until sync.
      try {
        await queueOp("order-deliver", { saleId: detail.id, locationId: vanId, paid: extra });
        const doneId = detail.id;
        setDetail(null);
        setRows((prev) => prev.filter((x) => x.id !== doneId));
        setQueuedIds((prev) => (prev.includes(doneId) ? prev : [...prev, doneId]));
        setNotice(labels.queuedOk ?? "queued");
      } catch (e) {
        setError(queueErrText(labels, e));
      }
    } finally {
      setBusy(false);
    }
  }
  async function reopen(id: string) {
    if (!canSell(role)) return;
    if (reopenArmed !== id) {
      setReopenArmed(id);
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/sales/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reopen" }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setError(d?.error ?? "failed");
        return;
      }
      const back = doneRows.find((x) => x.id === id);
      setReopenArmed(null);
      if (back) {
        setDoneRows((prev) => prev.filter((x) => x.id !== id));
        setRows((prev) => [{ ...back, status: "CONFIRMED" }, ...prev]);
      }
      router.refresh();
    } catch {
      // Offline: queue the reopen, move it back locally.
      try {
        await queueOp("sale-reopen", { saleId: id });
        const back = doneRows.find((x) => x.id === id);
        setReopenArmed(null);
        if (back) {
          setDoneRows((prev) => prev.filter((x) => x.id !== id));
          setRows((prev) => [{ ...back, status: "CONFIRMED" }, ...prev]);
        }
        setQueuedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
        setNotice(labels.queuedOk ?? "queued");
      } catch (e) {
        setError(queueErrText(labels, e));
      }
    } finally {
      setBusy(false);
    }
  }

  const rowCard = (r: Row, isDone: boolean) => (
    <div
      key={r.id}
      className="flex items-center gap-2 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3"
    >
      <button
        type="button"
        onClick={() => void openDetail(r)}
        data-testid="view-doc"
        className="flex min-w-0 flex-1 items-center gap-2 text-start"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black">
            {r.status === "CONFIRMED" ? "📦 " : r.status === "DELIVERED" ? "✓ " : ""}{r.number} · {r.client?.name ?? "—"}
            {(queuedIds.includes(r.id) || r.id.startsWith("pending:")) && <UnsyncedBadge className="ms-1 px-1.5" />}
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-[11px] opacity-60">
            <span className={cn(
              "rounded-full px-1.5 py-px text-[10px] font-black",
              r.status === "DRAFT" ? "bg-amber-500/10 text-amber-600" : r.status === "DELIVERED" ? "bg-emerald-500/15 text-emerald-600" : "bg-sky-500/10 text-sky-600"
            )}>
              {r.status}
            </span>
            <span className="tabular-nums">{r._count.lines}</span>
            <span className="tabular-nums opacity-80">{fmtDT(r.date as string, locale)}</span>
          </div>
        </div>
        <div className="shrink-0 text-sm font-black tabular-nums" dir="ltr">{r.total == null ? "…" : dzMoney(Number(r.total))}</div>
      </button>
      {!isDone && r.status === "CONFIRMED" && (
        <button
          type="button"
          aria-label={labels.deliver}
          onClick={() => openDeliver(r)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600"
        >
          <Truck size={17} />
        </button>
      )}
      {isDone && canSell(role) && (
        <button
          type="button"
          aria-label={labels.delivered}
          onClick={() => void reopen(r.id)}
          disabled={busy}
          className={cn(
            "flex h-11 shrink-0 items-center justify-center gap-1 rounded-xl px-2 text-xs font-black",
            reopenArmed === r.id ? "bg-red-500/15 text-red-500" : "bg-(--bg-sunken) opacity-70"
          )}
        >
          <RotateCcw size={15} />
          {reopenArmed === r.id ? "؟" : ""}
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-3 p-4 pb-8 md:p-5">
      <div className="flex items-center gap-2">
        <button
          aria-label="back"
          onClick={() => goPage(router, `/${locale}/livreur/${day}/dashboard`)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default)"
        >
          <ArrowLeft size={18} className="rtl:rotate-180" />
        </button>
        <h1 className="text-lg font-black">{labels.title ?? labels.commandes} ({rows.length + pending.length})</h1>
      </div>
      <div className="space-y-1.5">
        {pending.map((doc) =>
          rowCard(
            {
              id: `pending:${doc.opId}`,
              number: "…",
              status: "DRAFT",
              total: null,
              paid: doc.paid,
              date: new Date(doc.ts).toISOString(),
              client: doc.clientId
                ? { id: doc.clientId, name: doc.clientName ?? "…", code: doc.clientCode ?? "" }
                : null,
              _count: { lines: doc.lines.length },
            },
            false
          )
        )}
        {rows.map((r) => rowCard(r, false))}
        {rows.length + pending.length === 0 && <p className="text-center text-sm opacity-60">{labels.empty}</p>}
      </div>
      {notice && <p className="rounded-xl bg-emerald-500/10 p-2.5 text-xs font-bold text-emerald-600">{notice}</p>}
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}
      {doneRows.length > 0 && (
        <>
          <h2 className="pt-2 text-sm font-black opacity-60">{labels.delivered} ({doneRows.length})</h2>
          <div className="space-y-1.5">
            {doneRows.map((r) => rowCard(r, true))}
          </div>
        </>
      )}
      <Modal open={delivering !== null} onClose={() => setDelivering(null)} title={labels.deliver} icon={<Truck size={18} />} width="sm">
        <div className="space-y-3">
          <div className="rounded-xl bg-(--bg-sunken) px-3 py-2 text-sm font-bold">
            {delivering?.number} · {delivering?.client?.name ?? ""} · <span dir="ltr">{dzMoney(Number(delivering?.total ?? 0))}</span>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.paid}</label>
            <Input
              type="number" min={0} step="any" value={paid}
              onChange={(e) => setPaid(e.target.value)} dir="ltr"
              className="text-center font-black tabular-nums"
            />
            <div className="mt-1 text-[11px] font-bold opacity-60" dir="ltr">
              {dzMoney(Number(delivering?.total ?? 0))} − {dzMoney(Number(delivering?.paid ?? 0))} = {dzMoney(Math.max(0, Number(delivering?.total ?? 0) - Number(delivering?.paid ?? 0)))}
            </div>
          </div>
          {error && <p className="rounded-lg bg-red-500/10 p-2 text-xs font-bold text-red-500" dir="ltr">{error}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setDelivering(null)} className="flex-1">{labels.cancel}</Button>
            <Button onClick={() => void confirmDeliver()} disabled={busy} className="flex-[2]">
              {busy ? "…" : labels.confirm}
            </Button>
          </div>
        </div>
      </Modal>
      {/* ── Order detail form (no redirect) ── */}
      <Modal open={detail !== null} onClose={() => setDetail(null)} title={detail ? detail.number : ""} subtitle={detail?.client?.name ?? ""} icon={<ClipboardList size={18} />} width="lg">
        {detail && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={cn(
                "rounded-full px-2 py-1 font-black",
                detail.status === "DRAFT" ? "bg-amber-500/10 text-amber-600" : "bg-sky-500/15 text-sky-600"
              )}>
                {detail.status}
              </span>
              {detail.location && <span className="font-bold opacity-60">{detail.location.name}</span>}
            </div>
            {detail.client && (
              <div className="rounded-xl bg-(--bg-sunken) px-3 py-2 text-sm">
                <div className="font-black">{detail.client.name}</div>
                <div className="font-mono text-[11px] opacity-60" dir="ltr">
                  {detail.client.code}{detail.client.phone ? ` · ${detail.client.phone}` : ""}
                </div>
              </div>
            )}
            {/* Lines: 5-column table like the sale ticket */}
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] gap-x-0 overflow-hidden rounded-xl bg-(--bg-sunken) text-[11px] tabular-nums">
              <span className="border-b border-dashed border-black/10 px-1.5 py-1 text-start text-[9px] font-black opacity-60">{ticketLabels.design}</span>
              <span className="border-b border-dashed border-black/10 border-s border-dotted border-black/10 px-1 py-1 text-center text-[9px] font-black opacity-60" dir="ltr">{ticketLabels.unitPrice}</span>
              <span className="border-b border-dashed border-black/10 border-s border-dotted border-black/10 px-1 py-1 text-center text-[9px] font-black opacity-60">{ticketLabels.qty}</span>
              <span className="border-b border-dashed border-black/10 border-s border-dotted border-black/10 px-1 py-1 text-center text-[9px] font-black opacity-60" dir="ltr">{ticketLabels.price}</span>
              <span className="border-b border-dashed border-black/10 border-s border-dotted border-black/10 px-1 py-1 text-end text-[9px] font-black opacity-60" dir="ltr">{ticketLabels.total}</span>
              {detail.lines.map((l) => {
                const f = packOfLine(l);
                const b = Number((l as { baseQty?: unknown }).baseQty ?? 0);
                const perPiece = b > 0 ? Number((l as { lineTotal?: unknown }).lineTotal ?? 0) / b : 0;
                const img = l.product?.images?.[0]?.url ?? null;
                return (
                  <Fragment key={l.id}>
                    <span className="flex min-w-0 items-center gap-1.5 border-b border-dotted border-black/10 px-1.5 py-1.5 text-start font-bold">
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" loading="lazy" />
                      ) : (
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-(--bg-overlay) text-sm">📦</span>
                      )}
                      <span className="min-w-0 break-words">{l.product?.name ?? ""}</span>
                    </span>
                    <span className="whitespace-nowrap border-b border-dotted border-black/10 border-s px-1 py-1.5 text-center" dir="ltr">{f > 1 && perPiece > 0 ? dzMoney(perPiece) : "—"}</span>
                    <span className="whitespace-nowrap border-b border-dotted border-black/10 border-s px-1 py-1.5 text-center" dir="ltr">{dz(Number(l.qty))}{f > 1 ? ` × [${f % 1 === 0 ? f : f.toFixed(2)}]` : ""}</span>
                    <span className="whitespace-nowrap border-b border-dotted border-black/10 border-s px-1 py-1.5 text-center" dir="ltr">{dzMoney(Number((l as { unitPrice?: unknown }).unitPrice ?? 0))}</span>
                    <span className="whitespace-nowrap border-b border-dotted border-black/10 border-s px-1 py-1.5 text-end font-black" dir="ltr">{dzMoney(Number((l as { lineTotal?: unknown }).lineTotal ?? 0))}</span>
                  </Fragment>
                );
              })}
            </div>
            <div className="flex items-center justify-between rounded-xl bg-(--brand-500)/10 px-3 py-2 text-sm font-black">
              <span>{labels.total}</span>
              <span dir="ltr">{dzMoney(Number(detail.total))}</span>
            </div>
            {detail.status === "CONFIRMED" && (
              <div>
                <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.paid}</label>
                <Input
                  type="number" min={0} step="any" value={paid}
                  onChange={(e) => setPaid(e.target.value)} dir="ltr"
                  className="text-center font-black tabular-nums"
                />
              </div>
            )}
            {error && detail && <p className="rounded-lg bg-red-500/10 p-2 text-xs font-bold text-red-500" dir="ltr">{error}</p>}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => { setDetail(null); setError(null); setRevokeArmed(false); }} className="flex-1">{labels.cancel}</Button>
              {/* Vendeur has no facture actions on synced docs — but discarding
                  his OWN not-yet-synced order is local-only and always safe. */}
              {(detail.status === "DRAFT" || detail.status === "CONFIRMED") && (canSell(role) || detail.id.startsWith("pending:")) && (
                <Button
                  variant="secondary"
                  onClick={() => void revokeOrder()}
                  disabled={busy}
                  className={revokeArmed ? "flex-1 text-red-500" : "flex-1 opacity-70"}
                >
                  {revokeArmed ? `؟ ${labels.cancelOrder}` : labels.cancelOrder}
                </Button>
              )}
              <Button variant="secondary" onClick={() => void openPrint()} data-testid="pv-print" className="flex-1" aria-label={labels.print}>
                <Printer size={16} />
              </Button>
              {detail.status === "CONFIRMED" && (
                <Button onClick={() => void confirmDeliverDetail()} disabled={busy} className="flex-[2]">
                  {busy ? "…" : labels.deliver}
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
      {/* ── Order print preview (portal, like the sale ticket) ── */}
      {printing && printTicket() && typeof document !== "undefined" && createPortal(
        <div className="ticket-print-scope fixed inset-0 z-[70] overflow-y-auto bg-black/60 p-3">
          <div className="mx-auto w-fit max-w-full">
            <div className="overflow-hidden rounded-2xl bg-white shadow-2xl">
              <TicketView
                ticket={printTicket()!}
                company={ticketCo?.company ?? { name: "" }}
                width={ticketCo?.width ?? "80"}
                locale={locale}
                labels={ticketLabels}
                qrDataUrl={ticketQr}
                lang={ticketLang}
              />
            </div>
            <div className="no-print mx-auto mt-2 flex max-w-full gap-2 pb-6" style={{ width: `${ticketCo?.width ?? "80"}mm` }}>
              <Button variant="secondary" onClick={() => setPrinting(false)} className="flex-1" aria-label={labels.cancel}>
                <X size={16} />
              </Button>
              <Button variant="secondary" onClick={() => setPdfView(true)} data-testid="pv-share" className="flex-1">
                <Share2 size={16} className="me-1" />
                {ticketLabels.share}
              </Button>
              <Button onClick={doPrint} className="flex-[2]">
                <Printer size={16} className="me-1" />
                {labels.print}
              </Button>
            </div>
            {sharedMsg && (
              <div className="no-print mx-auto max-w-full pb-2 text-center text-xs font-bold text-white/90" style={{ width: `${ticketCo?.width ?? "80"}mm` }}>
                {sharedMsg}
              </div>
            )}
            {pdfView && printTicket() && (
              <PdfViewer
                ticket={printTicket()!}
                company={{ name: ticketCo?.company.name ?? "", phone: ticketCo?.company.phone ?? null, address: ticketCo?.company.address ?? null, rc: ticketCo?.company.rc ?? null, nif: ticketCo?.company.nif ?? null, logoUrl: ticketCo?.company.logoUrl ?? null }}
                lang={ticketLang}
                labels={ticketLabels}
                qrDataUrl={ticketQr}
                onClose={() => setPdfView(false)}
              />
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
