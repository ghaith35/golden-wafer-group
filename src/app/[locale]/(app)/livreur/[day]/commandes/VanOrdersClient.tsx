"use client";

import { Fragment, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ArrowLeft, ClipboardList, Printer, RotateCcw, Share2, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { TicketView, type TicketLabels, type TicketVM } from "@/components/sales/TicketView";
import { dz, dzMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

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
  rows: initial,
  doneRows: initialDone,
  labels,
  ticketLabels,
}: {
  locale: string;
  day: string;
  vanId: string;
  rows: Row[];
  doneRows: Row[];
  labels: Record<string, string>;
  ticketLabels: TicketLabels;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [doneRows, setDoneRows] = useState(initialDone);
  const [reopenArmed, setReopenArmed] = useState<string | null>(null);
  const [delivering, setDelivering] = useState<Row | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [paid, setPaid] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokeArmed, setRevokeArmed] = useState(false);

  async function openDetail(r: Row) {
    setRevokeArmed(false);
    try {
      const res = await fetch(`/api/sales/${r.id}`, { cache: "no-store" });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.id) {
        setDetail(d);
        setPaid(String(Number(d.total ?? 0)));
      }
    } catch { /* offline: stays closed */ }
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
  const [isNative, setIsNative] = useState(false);

  async function openPrint(from?: Detail | null) {
    const src = from ?? detail;
    if (!src) return;
    setPrinting(true);
    import("@capacitor/core").then(({ Capacitor }) => setIsNative(Capacitor.isNativePlatform())).catch(() => {});
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

  function doPrint() {
    document.body.classList.add("ticket-printing");
    const done = () => document.body.classList.remove("ticket-printing");
    window.addEventListener("afterprint", done, { once: true });
    window.setTimeout(done, 2500);
    window.print();
  }

  function doShare() {
    const t = printTicket();
    if (!t) return;
    const lines = [
      ticketCo?.company.name ?? "",
      `N° ${t.number}`,
      t.client ? `${t.client.name} (${t.client.code ?? ""})` : "",
      "----------------",
      ...(t.lines ?? []).map((l) => `${l.name}  ${l.qty} = ${l.lineTotal}`),
      "----------------",
      `${ticketLabels.total}: ${t.total}`,
    ].filter((x) => x !== "");
    const text = lines.join("\n");
    import("@capacitor/share")
      .then(({ Share }) => Share.share({ title: `N° ${t.number}`, text }))
      .catch(() => {
        try {
          void navigator.clipboard.writeText(text);
        } catch { /* ignore */ }
      });
  }

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
    try {
      const res = await fetch(`/api/sales/${delivering.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deliver", locationId: vanId, paid: extraFor(delivering.total, delivering.paid, paid) }),
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
    } finally {
      setBusy(false);
    }
  }

  async function revokeOrder() {
    if (!detail || busy) return;
    if (!revokeArmed) {
      setRevokeArmed(true);
      return;
    }
    setBusy(true);
    setError(null);
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
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeliverDetail() {
    if (!detail || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sales/${detail.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "deliver",
          locationId: vanId,
          paid: extraFor(detail.total, (detail as { paid?: unknown }).paid, paid),
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
    } finally {
      setBusy(false);
    }
  }
  async function reopen(id: string) {
    if (reopenArmed !== id) {
      setReopenArmed(id);
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
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
        className="flex min-w-0 flex-1 items-center gap-2 text-start"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black">
            {r.status === "CONFIRMED" ? "📦 " : r.status === "DELIVERED" ? "✓ " : ""}{r.number} · {r.client?.name ?? "—"}
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-[11px] opacity-60">
            <span className={cn(
              "rounded-full px-1.5 py-px text-[10px] font-black",
              r.status === "DRAFT" ? "bg-amber-500/10 text-amber-600" : r.status === "DELIVERED" ? "bg-emerald-500/15 text-emerald-600" : "bg-sky-500/10 text-sky-600"
            )}>
              {r.status}
            </span>
            <span className="tabular-nums">{r._count.lines}</span>
          </div>
        </div>
        <div className="shrink-0 text-sm font-black tabular-nums" dir="ltr">{dzMoney(Number(r.total))}</div>
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
      {isDone && (
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
          onClick={() => router.push(`/${locale}/livreur/${day}/dashboard`)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default)"
        >
          <ArrowLeft size={18} className="rtl:rotate-180" />
        </button>
        <h1 className="text-lg font-black">{labels.title ?? labels.commandes} ({rows.length})</h1>
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => rowCard(r, false))}
        {rows.length === 0 && <p className="text-center text-sm opacity-60">{labels.empty}</p>}
      </div>
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
              {(detail.status === "DRAFT" || detail.status === "CONFIRMED") && (
                <Button
                  variant="secondary"
                  onClick={() => void revokeOrder()}
                  disabled={busy}
                  className={revokeArmed ? "flex-1 text-red-500" : "flex-1 opacity-70"}
                >
                  {revokeArmed ? `؟ ${labels.cancelOrder}` : labels.cancelOrder}
                </Button>
              )}
              <Button variant="secondary" onClick={() => void openPrint()} className="flex-1" aria-label={labels.print}>
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
              />
            </div>
            <div className="no-print mx-auto mt-2 flex max-w-full gap-2 pb-6" style={{ width: `${ticketCo?.width ?? "80"}mm` }}>
              <Button variant="secondary" onClick={() => setPrinting(false)} className="flex-1" aria-label={labels.cancel}>
                <X size={16} />
              </Button>
              {isNative && (
                <Button variant="secondary" onClick={() => doShare()} className="flex-1">
                  <Share2 size={16} className="me-1" />
                  {ticketLabels.share}
                </Button>
              )}
              <Button onClick={doPrint} className="flex-[2]">
                <Printer size={16} className="me-1" />
                {labels.print}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
