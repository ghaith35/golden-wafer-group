"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { ArrowLeft, Printer, Share2, Trash2, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TicketView, type TicketLabels, type TicketVM } from "@/components/sales/TicketView";
import { TicketEditForm } from "./TicketEditForm";
import { queueOp, goPage, getUnsyncedDocKeys, getPendingDocs, discardOutboxOp, queueErrText, saveCachedDetail, getCachedDetail, type PendingDoc } from "@/lib/sync/client";
import { PdfViewer } from "@/components/sales/PdfViewer";
import { printTicketNative } from "@/lib/print-ticket";

import { dzMoney, fmtDT } from "@/lib/format";

type Row = { id: string; number: string; total: unknown; date: unknown; client: { name: string } | null };

type Detail = {
  id: string; number: string; status: string;
  total: unknown; paid: unknown; remise: unknown;
  notes: string | null; tierId: string | null;
  date: unknown;
  client: { id: string; name: string; code: string; phone: string | null } | null;
  location: { id: string; name: string } | null;
  lines: Array<{
    id: string; productId: string; qty: unknown; baseQty: unknown; unitId: string | null; unitPrice: unknown; remise: unknown; lineTotal: unknown;
    product: { name: string } | null;
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
}: {
  locale: string;
  day: string;
  rows: Row[];
  labels: Record<string, string>;
  ticketLabels: TicketLabels;
  ticketLang: "ar" | "fr";
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
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
  const [ticketCo, setTicketCo] = useState<{ company: { name: string; phone?: string | null; address?: string | null; rc?: string | null; nif?: string | null; logoUrl?: string | null }; width: "58" | "80"; currency: string } | null>(null);
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
          width: d.ticketWidth === "58" ? "58" : "80",
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
      seller: null,
      sellerPhone: null,
      lines: src.lines.map((l) => ({
        name: l.product?.name ?? "",
        qty: l.qty as number | string,
        baseQty: l.baseQty as number | string | null,
        unitPrice: l.unitPrice as number | string,
        lineTotal: l.lineTotal as number | string,
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


  async function printRow(r: Row) {
    const d = await openDetail(r);
    if (d) await openPrint(d);
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
    <div className="space-y-3 p-4 pb-8 md:p-5">
      <div className="flex items-center gap-2">
        <button
          aria-label="back"
          onClick={() => goPage(router, `/${locale}/livreur/${day}/dashboard`)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default)"
        >
          <ArrowLeft size={18} className="rtl:rotate-180" />
        </button>
        <h1 className="text-lg font-black">{labels.factures} ({rows.length + pending.length})</h1>
      </div>
      {notice && <p className="rounded-xl bg-emerald-500/10 p-2.5 text-xs font-bold text-emerald-600">{notice}</p>}
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}
      <div className="space-y-1.5">
        {pending.map((doc) => {
          const pr: Row = { id: `pending:${doc.opId}`, number: "…", total: doc.total ?? 0, date: new Date(doc.ts).toISOString(), client: doc.clientName ? { name: doc.clientName } : null };
          return (
            <div key={pr.id} className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-(--bg-overlay) p-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">… · {doc.clientName ?? ""}</div>
                <div className="flex items-center gap-1.5 text-[11px] opacity-60">
                  <span>{fmtDT(pr.date as string, locale)} · <b className="tabular-nums">{dzMoney(Number(pr.total))}</b></span>
                  <span className="flex shrink-0 items-center gap-1 rounded-full pill-amber px-1.5 py-px text-[10px] font-black opacity-100">
                    <WifiOff size={11} />
                    {labels.unsynced ?? "…"}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void openDetail(pr)}
                data-testid="view-doc"
                className="shrink-0 rounded-lg bg-(--bg-sunken) px-3 py-2 text-xs font-black"
              >
                {labels.viewSale}
              </button>
              <button
                type="button"
                onClick={() => void printRow(pr)}
                aria-label={labels.print}
                title={labels.print}
                data-testid="print-doc"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--brand-500)/10 text-(--brand-600)"
              >
                <Printer size={16} />
              </button>
              <button onClick={() => setDeleting(pr)} aria-label={labels.deleteSale} data-testid="delete-doc" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-500/10">
                <Trash2 size={16} />
              </button>
            </div>
          );
        })}
        {rows.map((t) => (
          <div key={t.id} className="flex items-center gap-2 rounded-xl border border-(--border-default) bg-(--bg-overlay) p-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">{t.number} · {t.client?.name ?? ""}</div>
              <div className="flex items-center gap-1.5 text-[11px] opacity-60">
                <span>{fmtDT(t.date as string, locale)} · <b className="tabular-nums">{dzMoney(Number(t.total))}</b></span>
                {unsynced.has(t.id) && (
                  <span className="flex shrink-0 items-center gap-1 rounded-full pill-amber px-1.5 py-px text-[10px] font-black opacity-100">
                    <WifiOff size={11} />
                    {labels.unsynced ?? "…"}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void openDetail(t)}
              data-testid="view-doc"
              className="shrink-0 rounded-lg bg-(--bg-sunken) px-3 py-2 text-xs font-black"
            >
              {labels.viewSale}
            </button>
            <button
              type="button"
              onClick={() => goPage(router, `/${locale}/livreur/${day}/vente?edit=${t.id}`)}
              aria-label={labels.edit ?? "Edit"}
              title={labels.edit ?? "Edit"}
              // Pending (offline-created) tickets have no server id to edit —
              // and edits need the server anyway.
              disabled={!online || t.id.startsWith("pending:")}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--brand-500)/10 text-(--brand-600) disabled:opacity-40"
            >
              ✎
            </button>
            <button
              type="button"
              onClick={() => void printRow(t)}
              aria-label={labels.print}
              title={labels.print}
              data-testid="print-doc"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--brand-500)/10 text-(--brand-600)"
            >
              <Printer size={16} />
            </button>
            <button onClick={() => setDeleting(t)} aria-label={labels.deleteSale} data-testid="delete-doc" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-500/10">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        {rows.length + pending.length === 0 && <p className="text-center text-sm opacity-60">{labels.empty}</p>}
      </div>
      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title={labels.confirmDelete} subtitle={deleting?.number ?? ""} icon={<Trash2 size={18} />}>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setDeleting(null)} className="flex-1" disabled={busy}>{labels.no}</Button>
          <Button onClick={() => void confirmDelete()} className="flex-1" disabled={busy}>{busy ? "…" : labels.yes}</Button>
        </div>
      </Modal>

      {/* ── In-place facture detail ── */}
      <Modal open={detail !== null} onClose={() => { setDetail(null); setError(null); }} title={detail?.number ?? ""} subtitle={detail?.client?.name ?? ""} icon={<Printer size={18} />}>
        {detail && (
          <div className="space-y-2">
            <div className="max-h-[40vh] space-y-1.5 overflow-y-auto pe-0.5">
              {detail.lines.map((l, i) => (
                <div key={l.id ?? i} className="flex items-center gap-2 rounded-xl bg-(--bg-sunken) px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-bold">{l.product?.name ?? ""}</span>
                  <span className="shrink-0 text-[11px] tabular-nums opacity-60" dir="ltr">
                    {dzMoney(Number(l.qty))} × {dzMoney(Number(l.unitPrice))}
                  </span>
                  <span className="shrink-0 text-sm font-black tabular-nums" dir="ltr">{dzMoney(Number(l.lineTotal))}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-xl bg-(--brand-500)/10 px-3 py-2 text-sm font-black">
              <span>{labels.total}</span>
              <span dir="ltr">{dzMoney(Number(detail.total))}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-(--bg-sunken) px-3 py-2 text-sm font-bold">
              <span className="opacity-60">{labels.paid}</span>
              <span dir="ltr">{dzMoney(Number(detail.paid ?? 0))}</span>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => { setDetail(null); setError(null); }} className="flex-1">{labels.cancel}</Button>
              {online && !detail.id.startsWith("pending:") && (
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
        )}
      </Modal>

      <Modal open={editing && detail !== null} onClose={() => setEditing(false)} title={`${labels.edit ?? "Edit"} · ${detail?.number ?? ""}`} icon="✎" width="lg">
        {editing && detail && (
          <TicketEditForm
            key={detail.id}
            saleId={detail.id}
            clientId={detail.client?.id ?? null}
            locationId={detail.location?.id ?? ""}
            tierId={detail.tierId}
            initialLines={detail.lines.map((l) => ({
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
