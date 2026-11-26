"use client";

import { ClientName } from "@/components/clients/ClientName";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import { ArrowLeft, Check, CheckCircle2, Clock, Eye, Lock, Printer, Share2, Trash2, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TicketView, type TicketLabels, type TicketVM } from "@/components/sales/TicketView";
import { TicketEditForm } from "./TicketEditForm";
import { queueOp, goPage, getUnsyncedDocKeys, getPendingDocs, discardOutboxOp, queueErrText, saveCachedDetail, getCachedDetail, type PendingDoc } from "@/lib/sync/client";
import { PdfViewer } from "@/components/sales/PdfViewer";
import { printTicketNative } from "@/lib/print-ticket";

import { dz, dzMoney, fmtDT } from "@/lib/format";
import { ProductThumb, useProductImages } from "@/components/products/ProductThumb";
import { useSyncedState } from "@/lib/data-sync";
import { cn } from "@/lib/utils";

import { ErrText } from "@/components/ui/ErrText";
type Row = { id: string; number: string; total: unknown; date: unknown; confirmedAt?: unknown; client: { name: string; gpsLat?: number | string | null; gpsLng?: number | string | null } | null };

type Detail = {
  id: string; number: string; status: string;
  total: unknown; paid: unknown; remise: unknown;
  notes: string | null; tierId: string | null;
  date: unknown;
  client: { id: string; name: string; code: string; phone: string | null; gpsLat?: number | string | null; gpsLng?: number | string | null } | null;
  location: { id: string; name: string } | null;
  lines: Array<{
    id: string; productId: string; qty: unknown; baseQty: unknown; unitId: string | null; unitPrice: unknown; remise: unknown; lineTotal: unknown;
    /// 3pack gift line.
    isBonus?: boolean;
    product: {
      name: string;
      images?: Array<{ url: string }>;
      conversions?: Array<{ unitId: string; factor: unknown; unit?: { name: string } | null }>;
      baseUnit?: { name: string } | null;
    } | null;
  }>;
};

/// Step 5 — inspect old factures: in-place detail + ticket print, or cancel.
/// The old admin-page link is gone (role guard bounced it) — everything
/// happens right here, online and offline.
export function FacturesClient({
  locale,
  day,
  rows: initial,
  labels,
  ticketLabels,
  ticketLang,
  driver,
  isAdmin = false,
}: {
  isAdmin?: boolean;
  locale: string;
  day: string;
  rows: Row[];
  labels: Record<string, string>;
  ticketLabels: TicketLabels;
  ticketLang: "ar" | "fr";
  /// Logged-in driver: name + phone printed on every ticket.
  driver?: { fullName: string; phone: string | null } | null;
}) {
  const router = useRouter();
  const t3 = useTranslations("threepack");
  const [rows, setRows] = useSyncedState(initial);
  /// Product photos for lines whose detail carries none (offline-created tickets).
  const phoneImages = useProductImages();
  const [unsynced, setUnsynced] = useState<Set<string>>(new Set());
  /// Tickets created offline (still in the outbox): shown first, openable,
  /// printable and shareable — the driver sees his sale the moment he saves
  /// it instead of waiting for the next sync.
  const [pending, setPending] = useState<PendingDoc[]>([]);
  useEffect(() => {
    let on = true;
    const load = () => {
      getUnsyncedDocKeys().then((s) => {
        if (on) setUnsynced(s);
      }).catch(() => {});
      getPendingDocs().then((d) => {
        if (on) setPending(d.filter((x) => x.kind === "ticket"));
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
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [confirming, setConfirming] = useState<Row | null>(null);
  /// Multi-select: ids of selected server tickets + the pending bulk action.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<"confirm" | "delete" | null>(null);
  const selectable = (r: Row) => !r.id.startsWith("pending:") && (isAdmin || !r.confirmedAt);
  const toggleSel = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  const [ticketCo, setTicketCo] = useState<{ company: { name: string; phone?: string | null; address?: string | null; rc?: string | null; nif?: string | null; nis?: string | null; logoUrl?: string | null }; width: "80"; currency: string } | null>(null);
  const [ticketQr, setTicketQr] = useState<string | null>(null);
  /// Share feedback inside the print preview (clipboard fallback notice).
  const [sharedMsg, setSharedMsg] = useState<string | null>(null);

  /// Local detail for an offline-created ticket (no server id yet): same
  /// shape as the server detail so the modal, print and share all work.
  function pendingDetail(doc: PendingDoc): Detail {
    return {
      id: `pending:${doc.opId}`,
      number: "…",
      status: "QUEUED",
      total: doc.total ?? 0,
      paid: doc.paid,
      remise: 0,
      notes: null,
      tierId: null,
      date: new Date(doc.ts).toISOString(),
      client: doc.clientId
        ? { id: doc.clientId, name: doc.clientName ?? "…", code: doc.clientCode ?? "", phone: doc.clientPhone }
        : null,
      location: null,
      lines: doc.lines.map((l, i) => ({
        id: `pending:${doc.opId}:${i}`,
        productId: l.productId,
        qty: l.qty,
        baseQty: null,
        unitId: null,
        unitPrice: l.unitPrice,
        remise: 0,
        lineTotal: l.lineTotal,
        isBonus: !!l.bonus,
        product: { name: l.name },
      })),
    };
  }

  async function openDetail(r: Row): Promise<Detail | null> {
    setError(null);
    // Offline-created ticket: open from the outbox payload, no server needed.
    if (r.id.startsWith("pending:")) {
      const doc = pending.find((x) => `pending:${x.opId}` === r.id);
      if (doc) {
        const d = pendingDetail(doc);
        setDetail(d);
        return d;
      }
    }
    try {
      const res = await fetch(`/api/sales/${r.id}`, { cache: "no-store" });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.id) {
        setDetail(d);
        void saveCachedDetail(r.id, d);
        return d;
      }
      setError(d?.error ?? "failed");
      return null;
    } catch {
      // Offline: serve the last online copy when there is one (stale
      // banner) — deliver/cancel/print resolve against the real server id.
      // The row itself stays visible either way.
      const cached = getCachedDetail<Detail>(r.id);
      if (cached) {
        setDetail(cached);
        setNotice(labels.staleData ?? null);
        return cached;
      }
      setError(labels.offline ?? "offline");
      return null;
    }
  }

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
          width: "80",
          currency: d.currency ?? "DZD",
        });
      }
    } catch { /* offline: preview without header */ }
    // Queued tickets have no server number yet — skip the QR, not the print.
    if (src.number === "…") {
      setTicketQr(null);
      return;
    }
    try {
      const { default: QRCode } = await import("qrcode");
      const url = await QRCode.toDataURL(
        JSON.stringify({ app: "distribuili", type: "ticket", n: src.number }),
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
      paid: Number(src.paid ?? 0),
      remise: 0,
      oldDebt: null,
      newDebt: null,
      client: src.client ? { name: src.client.name, code: src.client.code, phone: src.client.phone, tierName: null } : null,
      location: src.location ? { name: src.location.name } : null,
      seller: driver?.fullName ?? null,
      sellerPhone: driver?.phone ?? null,
      lines: src.lines.map((l) => ({
        name: l.product?.name ?? "",
        qty: l.qty as number | string,
        baseQty: l.baseQty as number | string | null,
        unitPrice: l.unitPrice as number | string,
        lineTotal: l.lineTotal as number | string,
        bonus: !!l.isBonus,
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
        company: { name: ticketCo?.company.name ?? "", phone: ticketCo?.company.phone ?? null, address: ticketCo?.company.address ?? null, rc: ticketCo?.company.rc ?? null, nif: ticketCo?.company.nif ?? null, nis: ticketCo?.company.nis ?? null, logoUrl: ticketCo?.company.logoUrl ?? null },
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


  async function printRow(r: Row) {
    const d = await openDetail(r);
    if (d) await openPrint(d);
  }

  /// ON HOLD → CONFIRMED (final: only an admin can change it afterwards).
  async function confirmTicketNow() {
    if (!confirming || busy) return;
    const target = confirming;
    setBusy(true);
    setError(null);
    setNotice(null);
    const done = () => {
      const at = new Date().toISOString();
      setConfirming(null);
      setRows((prev) => prev.map((r) => (r.id === target.id ? { ...r, confirmedAt: at } : r)));
      setNotice(labels.factureConfirmedOk ?? "✓");
    };
    try {
      const res = await fetch(`/api/sales/${target.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "validate" }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setError(d?.error ?? "failed");
        return;
      }
      done();
    } catch {
      try {
        await queueOp("sale-confirm", { saleId: target.id });
        done();
      } catch (e) {
        setError(queueErrText(labels, e));
      }
    } finally {
      setBusy(false);
    }
  }

  /// Runs one action over every selected ticket (sequential, so a slow link or
  /// a single failure never loses the others). Offline → queued like the
  /// single-ticket buttons.
  async function runBulk() {
    if (!bulk || busy) return;
    const kind = bulk;
    const targets = rows.filter((r) => selected.has(r.id) && selectable(r) && (kind === "delete" || !r.confirmedAt));
    if (!targets.length) {
      setBulk(null);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const okIds = new Set<string>();
    let failed = 0;
    let lastErr = "";
    for (const r of targets) {
      try {
        const res = await fetch(`/api/sales/${r.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: kind === "confirm" ? "validate" : "cancel" }),
        });
        if (res.ok) okIds.add(r.id);
        else {
          failed++;
          lastErr = String((await res.json().catch(() => null))?.error ?? "failed");
        }
      } catch {
        try {
          await queueOp(kind === "confirm" ? "sale-confirm" : "sale-cancel", { saleId: r.id });
          okIds.add(r.id);
        } catch (e) {
          failed++;
          lastErr = queueErrText(labels, e);
        }
      }
    }
    const at = new Date().toISOString();
    setRows((prev) =>
      kind === "confirm"
        ? prev.map((r) => (okIds.has(r.id) ? { ...r, confirmedAt: at } : r))
        : prev.filter((r) => !okIds.has(r.id)),
    );
    setSelected((prev) => new Set([...prev].filter((id) => !okIds.has(id))));
    setBulk(null);
    if (okIds.size) setNotice(kind === "confirm" ? `${labels.factureConfirmedOk} (${okIds.size})` : `${labels.discarded ?? "✓"} (${okIds.size})`);
    if (failed) setError(`${failed} ${labels.bulkFailed ?? "failed"}${lastErr ? ` — ${lastErr}` : ""}`);
    setBusy(false);
  }

  async function confirmDelete() {
    if (!deleting || busy) return;
    // Offline-created ticket: no server row exists — just drop the queued op.
    if (deleting.id.startsWith("pending:")) {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await discardOutboxOp(deleting.id.slice("pending:".length));
        const goneId = deleting.id;
        setDeleting(null);
        setPending((prev) => prev.filter((x) => `pending:${x.opId}` !== goneId));
        setNotice(labels.discarded ?? "deleted ✓");
      } catch {
        setError(labels.offline ?? "offline");
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/sales/${deleting.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setError(d?.error ?? "failed");
        return;
      }
      const goneId = deleting.id;
      setDeleting(null);
      setRows((prev) => prev.filter((r) => r.id !== goneId));
    } catch {
      // Offline: queue the cancellation, drop the row locally (it comes
      // back on next online load if the sync fails — failed ops stay
      // visible in the sync popup with retry).
      try {
        await queueOp("sale-cancel", { saleId: deleting.id });
        const goneId = deleting.id;
        setDeleting(null);
        setRows((prev) => prev.filter((r) => r.id !== goneId));
        setNotice(labels.queuedOk ?? "queued");
      } catch (e) {
        setError(queueErrText(labels, e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`space-y-2.5 px-3 py-3 sm:space-y-3 sm:p-4 md:p-5 ${selected.size ? "pb-36 sm:pb-32" : "pb-10"}`}>
      <div className="flex min-w-0 items-center gap-2">
        <button
          aria-label="back"
          onClick={() => goPage(router, `/${locale}/livreur/${day}/dashboard`)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default) bg-(--bg-overlay)"
        >
          <ArrowLeft size={18} className="rtl:rotate-180" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-[17px] font-black sm:text-lg">{labels.factures} <span className="tabular-nums" dir="ltr">({rows.length + pending.length})</span></h1>
      </div>
      {notice && <p className="rounded-xl bg-emerald-500/10 p-2.5 text-xs font-bold text-emerald-600">{notice}</p>}
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}
      <div className="space-y-2 sm:space-y-1.5">
        {pending.map((doc) => {
          const pr: Row = { id: `pending:${doc.opId}`, number: "…", total: doc.total ?? 0, date: new Date(doc.ts).toISOString(), client: doc.clientName ? { name: doc.clientName } : null };
          return (
            <div key={pr.id} className="rounded-2xl border border-amber-500/40 bg-(--bg-overlay) p-3 shadow-sm">
              <div className="flex items-start gap-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[15px] font-black" dir="ltr">…</span>
                    <span className="flex shrink-0 items-center gap-1 rounded-full pill-amber px-2 py-0.5 text-[10px] font-black">
                      <WifiOff size={11} />
                      {labels.unsynced ?? "…"}
                    </span>
                  </div>
                  <div className="mt-0.5 min-w-0 truncate text-sm font-bold"><ClientName name={doc.clientName} map={false} /></div>
                  <div className="text-[11px] font-bold opacity-60">{fmtDT(pr.date as string, locale)}</div>
                </div>
                <div className="shrink-0 text-end text-base font-black tabular-nums" dir="ltr">{dzMoney(Number(pr.total))}</div>
              </div>
              <div className="mt-2.5 flex items-stretch gap-1.5">
                <button
                  type="button"
                  onClick={() => void openDetail(pr)}
                  data-testid="view-doc"
                  className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-(--bg-sunken) px-2 text-sm font-black active:scale-[0.98]"
                >
                  <Eye size={16} className="shrink-0" />
                  <span className="truncate">{labels.viewSale}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void printRow(pr)}
                  aria-label={labels.print}
                  title={labels.print}
                  data-testid="print-doc"
                  className="flex h-10 w-11 shrink-0 items-center justify-center rounded-xl bg-(--brand-500)/10 text-(--brand-600) active:scale-[0.98]"
                >
                  <Printer size={17} />
                </button>
                <button onClick={() => setDeleting(pr)} aria-label={labels.deleteSale} data-testid="delete-doc" className="flex h-10 w-11 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-500 active:scale-[0.98]">
                  <Trash2 size={17} />
                </button>
              </div>
            </div>
          );
        })}
        {rows.map((t) => {
          const held = !t.confirmedAt;
          const locked = !isAdmin && !held;
          const isPending = t.id.startsWith("pending:");
          return (
          <div key={t.id} className={`rounded-2xl border bg-(--bg-overlay) p-3 shadow-sm ${held ? "border-amber-500/40" : "border-(--border-default)"}`}>
            <div className="flex items-start gap-2.5">
              {selectable(t) && (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={selected.has(t.id)}
                  onClick={() => toggleSel(t.id)}
                  data-testid="select-doc"
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${selected.has(t.id) ? "border-(--brand-600) bg-(--brand-600) text-white" : "border-(--border-default)"}`}
                >
                  {selected.has(t.id) && <Check size={14} strokeWidth={3} />}
                </button>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[15px] font-black" dir="ltr">{t.number}</span>
                  {held ? (
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-black text-amber-600">
                      <Clock size={11} />
                      {labels.factureHold}
                    </span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-black text-emerald-600">
                      <CheckCircle2 size={11} />
                      {labels.factureConfirmed}
                    </span>
                  )}
                  {unsynced.has(t.id) && (
                    <span className="flex shrink-0 items-center gap-1 rounded-full pill-amber px-2 py-0.5 text-[10px] font-black">
                      <WifiOff size={11} />
                      {labels.unsynced ?? "…"}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 min-w-0 truncate text-sm font-bold"><ClientName name={t.client?.name} lat={t.client?.gpsLat} lng={t.client?.gpsLng} /></div>
                <div className="text-[11px] font-bold opacity-60">{fmtDT(t.date as string, locale)}</div>
              </div>
              <div className="shrink-0 text-end text-base font-black tabular-nums" dir="ltr">{dzMoney(Number(t.total))}</div>
            </div>
            <div className="mt-2.5 flex items-stretch gap-1.5">
              <button
                type="button"
                onClick={() => void openDetail(t)}
                data-testid="view-doc"
                className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-(--bg-sunken) px-2 text-sm font-black active:scale-[0.98]"
              >
                <Eye size={16} className="shrink-0" />
                <span className="truncate">{labels.viewSale}</span>
              </button>
              {held && !isPending && (
                <button
                  type="button"
                  onClick={() => { setError(null); setConfirming(t); }}
                  data-testid="confirm-doc"
                  className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-2 text-sm font-black text-white active:scale-[0.98]"
                >
                  <CheckCircle2 size={16} className="shrink-0" />
                  <span className="truncate">{labels.confirmFacture}</span>
                </button>
              )}
              {!locked && (
                <button
                  type="button"
                  onClick={() => goPage(router, `/${locale}/livreur/${day}/vente?edit=${t.id}`)}
                  aria-label={labels.edit ?? "Edit"}
                  title={labels.edit ?? "Edit"}
                  // Pending (offline-created) tickets have no server id to edit —
                  // and edits need the server anyway.
                  disabled={!online || isPending}
                  className="flex h-10 w-11 shrink-0 items-center justify-center rounded-xl bg-(--brand-500)/10 text-base text-(--brand-600) active:scale-[0.98] disabled:opacity-40"
                >
                  ✎
                </button>
              )}
              <button
                type="button"
                onClick={() => void printRow(t)}
                aria-label={labels.print}
                title={labels.print}
                data-testid="print-doc"
                className="flex h-10 w-11 shrink-0 items-center justify-center rounded-xl bg-(--brand-500)/10 text-(--brand-600) active:scale-[0.98]"
              >
                <Printer size={17} />
              </button>
              {locked ? (
                <span title={labels.factureLocked} aria-label={labels.factureLocked} className="flex h-10 w-11 shrink-0 items-center justify-center rounded-xl bg-(--bg-sunken) text-(--text-muted) opacity-70">
                  <Lock size={16} />
                </span>
              ) : (
                <button onClick={() => setDeleting(t)} aria-label={labels.deleteSale} data-testid="delete-doc" className="flex h-10 w-11 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-500 active:scale-[0.98]">
                  <Trash2 size={17} />
                </button>
              )}
            </div>
          </div>
          );
        })}
        {rows.length + pending.length === 0 && <p className="text-center text-sm opacity-60">{labels.empty}</p>}
      </div>
      {selected.size > 0 && (
        <div className="gw-bottom-bar pb-[calc(0.75rem+var(--safe-floor))] flex flex-wrap items-center gap-2 border-t border-(--border-default) bg-(--bg-overlay) px-3 py-2.5 shadow-lg">
          <button type="button" onClick={() => setSelected(new Set())} aria-label={labels.cancel} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-(--bg-sunken)">
            <X size={18} />
          </button>
          <div className="min-w-[90px] flex-1">
            <div className="whitespace-nowrap text-sm font-black tabular-nums" dir="ltr">{selected.size} · <span dir="auto">{labels.facturesSelected}</span></div>
            <button
              type="button"
              onClick={() => setSelected(new Set(rows.filter(selectable).map((r) => r.id)))}
              className="whitespace-nowrap text-[11px] font-bold text-(--brand-600)"
            >
              {labels.selectAllFactures}
            </button>
          </div>
          {rows.some((r) => selected.has(r.id) && !r.confirmedAt) && (
            <button type="button" onClick={() => setBulk("confirm")} data-testid="bulk-confirm" className="flex h-11 min-w-[130px] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-emerald-600 px-3 text-[13px] font-black text-white sm:flex-none">
              <CheckCircle2 size={16} />
              {labels.confirmFacture} <span className="tabular-nums" dir="ltr">({rows.filter((r) => selected.has(r.id) && !r.confirmedAt).length})</span>
            </button>
          )}
          <button type="button" onClick={() => setBulk("delete")} data-testid="bulk-delete" aria-label={labels.deleteSale} className="flex h-11 min-w-[110px] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-red-500/10 px-3 text-[13px] font-black text-red-500 sm:flex-none">
            <Trash2 size={16} />
            {labels.deleteSale}
          </button>
        </div>
      )}
      <Modal open={bulk !== null} onClose={() => setBulk(null)} title={bulk === "delete" ? labels.confirmDelete : labels.confirmFactureTitle} subtitle={`${selected.size} ${labels.facturesSelected}`} icon={bulk === "delete" ? <Trash2 size={18} /> : <CheckCircle2 size={18} />}>
        {bulk === "confirm" && <p className="mb-3 rounded-xl bg-amber-500/10 p-3 text-sm font-bold text-amber-700">{labels.confirmFactureMsg}</p>}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setBulk(null)} className="flex-1" disabled={busy}>{labels.no}</Button>
          <Button onClick={() => void runBulk()} className="flex-1" disabled={busy}>{busy ? "…" : bulk === "delete" ? labels.yes : labels.confirmFacture}</Button>
        </div>
      </Modal>
      <Modal open={confirming !== null} onClose={() => setConfirming(null)} title={labels.confirmFactureTitle} subtitle={confirming?.number ?? ""} icon={<CheckCircle2 size={18} />}>
        <p className="mb-3 rounded-xl bg-amber-500/10 p-3 text-sm font-bold text-amber-700">{labels.confirmFactureMsg}</p>
        {error && <p className="mb-2 rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setConfirming(null)} className="flex-1" disabled={busy}>{labels.no}</Button>
          <Button onClick={() => void confirmTicketNow()} className="flex-1" disabled={busy}>{busy ? "…" : labels.confirmFacture}</Button>
        </div>
      </Modal>
      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title={labels.confirmDelete} subtitle={deleting?.number ?? ""} icon={<Trash2 size={18} />}>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setDeleting(null)} className="flex-1" disabled={busy}>{labels.no}</Button>
          <Button onClick={() => void confirmDelete()} className="flex-1" disabled={busy}>{busy ? "…" : labels.yes}</Button>
        </div>
      </Modal>

      {/* ── In-place facture detail ── */}
      <Modal open={detail !== null} onClose={() => { setDetail(null); setError(null); }} title={detail?.number ?? ""} subtitle={detail?.client?.name ?? ""} icon={<Printer size={18} />} width="lg">
        {detail && (() => {
          const total = Number(detail.total ?? 0);
          const paid = Number(detail.paid ?? 0);
          const remise = Number(detail.remise ?? 0);
          const remaining = Math.round((total - paid) * 100) / 100;
          const confirmed = !!rows.find((r) => r.id === detail.id)?.confirmedAt;
          const queued = detail.status === "QUEUED" || detail.id.startsWith("pending:");
          const lineInfo = detail.lines.map((l) => {
            const conv = l.product?.conversions?.find((c) => c.unitId === l.unitId);
            const f = conv ? Math.round(Number(conv.factor) * 1000) / 1000 : 1;
            const base = l.product?.baseUnit?.name ?? "";
            const unit = conv?.unit?.name ?? base;
            const pack = f > 1;
            const qty = Number(l.qty);
            return { unit, base, pack, f, qty, pieces: pack ? Math.round(qty * f * 1000) / 1000 : qty };
          });
          const packsCount = lineInfo.reduce((x, i) => x + (i.pack ? i.qty : 0), 0);
          return (
            <div className="space-y-3" data-testid="invoice-detail">
              {/* ── Header: number, date, status, client ── */}
              <div className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xl font-black tabular-nums" dir="ltr">{detail.number}</div>
                    <div className="text-xs font-bold opacity-60">{fmtDT(detail.date as string, locale)}{detail.location?.name ? ` · ${detail.location.name}` : ""}</div>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black",
                      queued ? "bg-amber-500/15 text-amber-600" : confirmed ? "bg-emerald-600/15 text-emerald-600" : "bg-sky-500/15 text-sky-600",
                    )}
                  >
                    {queued ? "⏳" : confirmed ? "🔒" : "●"} {queued ? labels.unsynced : confirmed ? labels.factureConfirmed : labels.factureHold}
                  </span>
                </div>
                {detail.client && (
                  <div className="mt-2.5 flex items-center gap-2.5 rounded-xl bg-(--bg-sunken) p-2.5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--brand-500)/15 text-base font-black text-(--brand-600)">
                      {detail.client.name.trim().charAt(0)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-black">{detail.client.name}</div>
                      <div className="truncate font-mono text-[11px] opacity-60" dir="ltr">
                        {detail.client.code}{detail.client.phone ? ` · ${detail.client.phone}` : ""}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Items table ── */}
              <div className="overflow-hidden rounded-2xl border border-(--border-default) bg-(--bg-overlay)">
                <div className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-x-2 bg-(--bg-sunken) px-3 py-2 text-[10px] font-black uppercase tracking-wide opacity-70 sm:grid-cols-[3rem_minmax(0,1fr)_6rem_6.5rem_7.5rem]">
                  <span>#</span>
                  <span>{labels.product}</span>
                  <span className="hidden text-center sm:block">{labels.qty}</span>
                  <span className="hidden text-center sm:block">{labels.price}</span>
                  <span className="text-end">{labels.total}</span>
                </div>
                <div className="max-h-[calc(var(--vh)*0.42)] divide-y divide-(--border-default) overflow-y-auto">
                  {detail.lines.length === 0 && <p className="p-4 text-center text-sm opacity-60">{labels.invNoLines}</p>}
                  {detail.lines.map((l, i) => {
                    const info = lineInfo[i];
                    const imgs = l.product?.images?.map((x) => x.url) ?? phoneImages.get(l.productId) ?? [];
                    return (
                      <div
                        key={l.id ?? i}
                        className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-x-2 px-3 py-2.5 sm:grid-cols-[3rem_minmax(0,1fr)_6rem_6.5rem_7.5rem]"
                      >
                        <ProductThumb name={l.product?.name ?? ""} images={imgs} className="h-12 w-12 rounded-xl" />
                        <div className="min-w-0">
                          <div className="line-clamp-2 break-words text-sm font-black leading-tight">
                            {l.product?.name ?? ""}
                            {l.isBonus && <span className="ms-1.5 rounded-full bg-emerald-600 px-1.5 py-px align-middle text-[9px] font-black uppercase text-white">★ {t3("free")}</span>}
                          </div>
                          {/* phone: quantity × price on one compact line under the name */}
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] font-bold tabular-nums opacity-70 sm:hidden" dir="ltr">
                            <span><bdi>{dz(info.qty)}</bdi> {info.unit}</span>
                            <span>×</span>
                            <span>{dzMoney(Number(l.unitPrice))}</span>
                          </div>
                          {info.pack && (
                            <div className="mt-0.5 text-[10.5px] font-bold text-(--brand-600)">
                              <bdi>1 {info.unit}</bdi> = <bdi>{info.f} {info.base}</bdi>
                              {info.qty > 0 && <> · <bdi>{dz(info.pieces)} {labels.invPieces}</bdi></>}
                            </div>
                          )}
                        </div>
                        <div className="hidden text-center text-sm font-black tabular-nums sm:block" dir="ltr">
                          <bdi>{dz(info.qty)}</bdi>
                          {info.unit && <div className="text-[10px] font-bold opacity-60">{info.unit}</div>}
                        </div>
                        <div className="hidden text-center text-sm font-bold tabular-nums sm:block" dir="ltr">{dzMoney(Number(l.unitPrice))}</div>
                        <div className="text-end text-sm font-black tabular-nums" dir="ltr">{dzMoney(Number(l.lineTotal))}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── Totals ── */}
              <div className="overflow-hidden rounded-2xl border border-(--border-default) bg-(--bg-overlay)">
                <div className="flex items-center justify-between px-3 py-2 text-xs font-bold opacity-70">
                  <span>{labels.articles}: <bdi className="tabular-nums">{detail.lines.length}</bdi></span>
                  {packsCount > 0 && <span>{labels.packs}: <bdi className="tabular-nums">{dz(packsCount, 0)}</bdi></span>}
                </div>
                {remise > 0 && (
                  <div className="flex items-center justify-between border-t border-(--border-default) px-3 py-2 text-sm font-bold">
                    <span className="opacity-70">{labels.remise}</span>
                    <span className="tabular-nums" dir="ltr">− {dzMoney(remise)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t-2 border-(--brand-500) bg-(--brand-500)/10 px-3 py-2.5 text-lg font-black">
                  <span>{labels.total}</span>
                  <span className="tabular-nums" dir="ltr" data-testid="invoice-total">{dzMoney(total)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-(--border-default) px-3 py-2 text-sm font-bold">
                  <span className="opacity-70">{labels.paid}</span>
                  <span className="tabular-nums" dir="ltr">{dzMoney(paid)}</span>
                </div>
                <div className={cn("flex items-center justify-between border-t border-(--border-default) px-3 py-2 text-sm font-black", remaining > 0.005 ? "bg-red-500/10 text-red-600" : "bg-emerald-600/10 text-emerald-600")}>
                  <span>{remaining > 0.005 ? labels.invRemaining : labels.invSettled}</span>
                  {remaining > 0.005 && <span className="tabular-nums" dir="ltr">{dzMoney(remaining)}</span>}
                </div>
              </div>
              {detail.notes && (
                <p className="rounded-xl bg-(--bg-sunken) px-3 py-2 text-xs font-bold"><span className="opacity-60">{labels.notes}: </span>{detail.notes}</p>
              )}

              {/* ── Actions ── */}
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => { setDetail(null); setError(null); }} className="flex-1">{labels.invClose}</Button>
                {online && !detail.id.startsWith("pending:") && (isAdmin || !confirmed) && (
                  <Button variant="secondary" onClick={() => setEditing(true)} className="flex-1">
                    ✎ {labels.edit ?? "Edit"}
                  </Button>
                )}
                <Button onClick={() => void openPrint()} data-testid="pv-print" className="flex-[2]">
                  <Printer size={16} className="me-1" />
                  {labels.print}
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      <Modal open={editing && detail !== null} onClose={() => setEditing(false)} title={`${labels.edit ?? "Edit"} · ${detail?.number ?? ""}`} icon="✎" width="lg">
        {editing && detail && (
          <TicketEditForm
            key={detail.id}
            saleId={detail.id}
            clientId={detail.client?.id ?? null}
            locationId={detail.location?.id ?? ""}
            tierId={detail.tierId}
            initialLines={detail.lines.filter((l) => !l.isBonus).map((l) => ({
              productId: (l as { productId?: string }).productId ?? "",
              unitId: l.unitId,
              qty: Number(l.qty),
              unitPrice: Number(l.unitPrice),
              remise: 0,
            }))}
            initialPaid={Number(detail.paid ?? 0)}
            initialNotes={detail.notes}
            labels={labels}
            onSaved={() => {
              setEditing(false);
              const r = rows.find((x) => x.id === detail.id);
              if (r) void openDetail(r);
            }}
            onClose={() => setEditing(false)}
          />
        )}
      </Modal>

      {/* ── Ticket print preview (portal, like the sale ticket) ── */}
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
                company={{ name: ticketCo?.company.name ?? "", phone: ticketCo?.company.phone ?? null, address: ticketCo?.company.address ?? null, rc: ticketCo?.company.rc ?? null, nif: ticketCo?.company.nif ?? null, nis: ticketCo?.company.nis ?? null, logoUrl: ticketCo?.company.logoUrl ?? null }}
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
