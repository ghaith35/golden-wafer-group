"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { BadgeCheck, CalendarClock, Package, Phone, Printer, ReceiptText, RefreshCw, Share2, Star, WifiOff, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { AnimatedText } from "@/components/motion/AnimatedText";
import { TicketView, type TicketLabels, type TicketVM } from "@/components/sales/TicketView";
import { PdfViewer } from "@/components/sales/PdfViewer";
import { ProductThumb, useProductImages } from "@/components/products/ProductThumb";
import { getCachedDetail, saveCachedDetail } from "@/lib/sync/client";
import { printTicketNative } from "@/lib/print-ticket";
import { haptic } from "@/lib/motion";
import { dz, dzMoney, fmtDT } from "@/lib/format";
import { cn } from "@/lib/utils";

type Line = {
  id: string; productId: string; qty: unknown; baseQty: unknown; unitId: string | null; unitPrice: unknown; lineTotal: unknown;
  isBonus?: boolean;
  product: {
    name: string;
    images?: Array<{ url: string }>;
    conversions?: Array<{ unitId: string; factor: unknown; unit?: { name: string } | null }>;
    baseUnit?: { name: string } | null;
  } | null;
};
type Detail = {
  id: string; number: string; status: string; kind?: string;
  total: unknown; paid: unknown; remise: unknown; notes: string | null; date: unknown; confirmedAt?: unknown;
  client: { id: string; name: string; code: string; phone: string | null } | null;
  location: { id: string; name: string } | null;
  lines: Line[];
};
type Company = { name: string; phone?: string | null; address?: string | null; rc?: string | null; nif?: string | null; nis?: string | null; logoUrl?: string | null };

/// Full-detail invoice popup for the client page: hero with payment progress,
/// every product with photo / quantity / colisage maths, totals, then print
/// (native Bluetooth / system dialog / browser) and PDF share.
export function InvoiceSheet({
  saleId, locale, labels, ticketLabels, ticketLang, driver, onClose,
}: {
  /// null = closed (the sheet stays mounted so the exit animation can play).
  saleId: string | null;
  locale: string;
  labels: Record<string, string>;
  ticketLabels: TicketLabels;
  ticketLang: "ar" | "fr";
  driver?: { fullName: string; phone: string | null } | null;
  onClose: () => void;
}) {
  const t3 = useTranslations("threepack");
  const loc = `${locale}-u-nu-latn`;
  const phoneImages = useProductImages();

  // ── load (online first, last good copy when offline) ──
  const [res, setRes] = useState<{ id: string; detail: Detail | null; stale: boolean } | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!saleId) return;
    let dead = false;
    (async () => {
      try {
        const r = await fetch(`/api/sales/${encodeURIComponent(saleId)}`, { cache: "no-store" });
        const d = await r.json().catch(() => null);
        if (dead) return;
        if (r.ok && d?.id) {
          void saveCachedDetail(saleId, d);
          setRes({ id: saleId, detail: d, stale: false });
        } else {
          setRes({ id: saleId, detail: null, stale: false });
        }
      } catch {
        if (dead) return;
        const cached = getCachedDetail<Detail>(saleId);
        setRes({ id: saleId, detail: cached, stale: !!cached });
      }
    })();
    return () => { dead = true; };
  }, [saleId, tries]);
  const loading = !!saleId && res?.id !== saleId;
  const detail = res && (res.id === saleId || !saleId) ? res.detail : null;
  const stale = !!res?.stale;

  // Bar fills after the sheet has painted, so it visibly animates in.
  const [barOn, setBarOn] = useState(false);
  useEffect(() => {
    if (!detail) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setBarOn(true)));
    return () => { cancelAnimationFrame(id); setBarOn(false); };
  }, [detail?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── derived numbers ──
  const v = useMemo(() => {
    if (!detail) return null;
    const total = Number(detail.total ?? 0);
    const paid = Number(detail.paid ?? 0);
    const remise = Number(detail.remise ?? 0);
    const remaining = Math.round((total - paid) * 100) / 100;
    const settled = remaining <= 0.005;
    const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((paid / total) * 100))) : 100;
    const lines = detail.lines.map((l) => {
      const conv = l.product?.conversions?.find((c) => c.unitId === l.unitId);
      const f = conv ? Math.round(Number(conv.factor) * 1000) / 1000 : 1;
      const base = l.product?.baseUnit?.name ?? "";
      const unit = conv?.unit?.name ?? base;
      const qty = Number(l.qty);
      const pack = f > 1;
      return { l, unit, base, pack, f, qty, pieces: pack ? Math.round(qty * f * 1000) / 1000 : qty };
    });
    const packs = lines.reduce((s, x) => s + (x.pack ? x.qty : 0), 0);
    return { total, paid, remise, remaining, settled, pct, lines, packs };
  }, [detail]);

  // ── ticket / print ──
  const [preview, setPreview] = useState(false);
  const [pdfView, setPdfView] = useState(false);
  const [co, setCo] = useState<{ company: Company; width: "80" } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const ticket: TicketVM | null = useMemo(() => {
    if (!detail) return null;
    return {
      number: detail.number,
      date: String(detail.date ?? new Date().toISOString()),
      total: detail.total as number | string,
      paid: Number(detail.paid ?? 0),
      remise: 0,
      oldDebt: null,
      newDebt: null,
      client: detail.client ? { name: detail.client.name, code: detail.client.code, phone: detail.client.phone, tierName: null } : null,
      location: detail.location ? { name: detail.location.name } : null,
      seller: driver?.fullName ?? null,
      sellerPhone: driver?.phone ?? null,
      lines: detail.lines.map((l) => ({
        name: l.product?.name ?? "",
        qty: l.qty as number | string,
        baseQty: l.baseQty as number | string | null,
        unitPrice: l.unitPrice as number | string,
        lineTotal: l.lineTotal as number | string,
        bonus: !!l.isBonus,
      })),
    };
  }, [detail, driver]);

  const openPreview = useCallback(async (withPdf = false) => {
    if (!detail) return;
    haptic("tap");
    setMsg(null);
    setPdfView(withPdf);
    setPreview(true);
    try {
      const r = await fetch("/api/settings/public", { cache: "no-store" });
      const d = await r.json().catch(() => null);
      if (d) setCo({ company: d.company ?? { name: "" }, width: "80" });
    } catch { /* offline: preview without the company header */ }
    try {
      const { default: QRCode } = await import("qrcode");
      setQr(await QRCode.toDataURL(JSON.stringify({ app: "distribuili", type: "ticket", n: detail.number }), { margin: 1, width: 160 }));
    } catch { /* no QR */ }
  }, [detail]);

  async function doPrint() {
    if (!ticket) return;
    const company: Company = {
      name: co?.company.name ?? "", phone: co?.company.phone ?? null, address: co?.company.address ?? null,
      rc: co?.company.rc ?? null, nif: co?.company.nif ?? null, nis: co?.company.nis ?? null, logoUrl: co?.company.logoUrl ?? null,
    };
    // APK first: Bluetooth printer screen / system dialog (window.print is a no-op in the WebView).
    const r = await printTicketNative({ ticket, company, width: co?.width ?? "80", labels: ticketLabels, lang: ticketLang, qrDataUrl: qr });
    if (r.ok) return;
    try {
      const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
      if (cap?.isNativePlatform?.()) { setMsg(`${ticketLabels.printFail ?? "print failed"} (${r.reason})`); return; }
    } catch { /* fall through to the browser */ }
    document.body.classList.add("ticket-printing");
    const done = () => document.body.classList.remove("ticket-printing");
    window.addEventListener("afterprint", done, { once: true });
    window.setTimeout(done, 2500);
    window.print();
  }

  const tone = v?.settled ? "emerald" : (v?.paid ?? 0) <= 0 ? "red" : "amber";
  const statusText = v?.settled ? labels.invSettled : (v?.paid ?? 0) <= 0 ? labels.invUnpaid : labels.invPartial;

  return (
    <>
      <Modal
        open={!!saleId}
        onClose={onClose}
        title={detail?.number ?? labels.invoiceTitle}
        subtitle={detail?.client?.name ?? ""}
        icon={<ReceiptText size={18} />}
        width="lg"
      >
        {loading && <Skeleton />}

        {!loading && !detail && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <WifiOff size={30} className="opacity-50" />
            <p className="text-sm font-bold opacity-70">{labels.offline}</p>
            <Button variant="secondary" onClick={() => setTries((n) => n + 1)}><RefreshCw size={15} className="me-1.5" />{labels.invRetry}</Button>
          </div>
        )}

        {!loading && detail && v && (
          <div className="space-y-3" data-testid="invoice-detail">
            {stale && (
              <p className="flex items-center gap-2 rounded-xl bg-amber-500/10 p-2.5 text-xs font-black text-amber-600"><WifiOff size={14} />{labels.staleData}</p>
            )}

            {/* ── Hero ── */}
            <div className="gw-rise relative overflow-hidden rounded-3xl bg-gradient-brand p-4 text-(--brand-contrast) shadow-lg">
              <span aria-hidden className="pointer-events-none absolute -end-10 -top-12 h-40 w-40 rounded-full bg-white/15 blur-sm" />
              <span aria-hidden className="pointer-events-none absolute -bottom-16 -start-8 h-36 w-36 rounded-full bg-black/10" />
              <div className="relative flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-mono text-lg font-black tabular-nums" dir="ltr">{detail.number}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] font-bold opacity-85">
                    <CalendarClock size={12} />{fmtDT(detail.date as string, loc)}{detail.location?.name ? ` · ${detail.location.name}` : ""}
                  </div>
                </div>
                <span className={cn("flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black text-white shadow", tone === "emerald" ? "bg-emerald-600" : tone === "red" ? "bg-red-600" : "bg-amber-500")}>
                  {v.settled && <BadgeCheck size={13} />}{statusText}
                </span>
              </div>
              <div className="relative mt-4">
                <div className="text-[11px] font-black uppercase tracking-wide opacity-80">{labels.total}</div>
                <div className="text-4xl font-black tabular-nums leading-tight" dir="ltr" data-testid="invoice-total">
                  <AnimatedText text={dzMoney(v.total)} />
                </div>
              </div>
              <div className="relative mt-3">
                <div className="h-2.5 overflow-hidden rounded-full bg-black/20">
                  <div
                    className={cn("h-full rounded-full transition-[width] duration-1000 ease-out", tone === "emerald" ? "bg-emerald-300" : tone === "red" ? "bg-red-300" : "bg-amber-300")}
                    style={{ width: barOn ? `${v.pct}%` : "0%" }}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px] font-black">
                  <span>{labels.paid} <span className="tabular-nums" dir="ltr">{dzMoney(v.paid)}</span> · {v.pct}%</span>
                  {!v.settled && <span className="tabular-nums" dir="ltr">{labels.invRemaining} {dzMoney(v.remaining)}</span>}
                </div>
              </div>
            </div>

            {/* ── Client ── */}
            {detail.client && (
              <div className="gw-rise flex items-center gap-2.5 rounded-2xl border border-(--border-default) bg-(--bg-surface) p-2.5" style={{ animationDelay: "60ms" }}>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-(--brand-500)/15 text-lg font-black text-(--brand-600)">
                  {detail.client.name.trim().charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-black">{detail.client.name}</div>
                  <div className="truncate font-mono text-[11px] opacity-60" dir="ltr">{detail.client.code}{detail.client.phone ? ` · ${detail.client.phone}` : ""}</div>
                </div>
                {detail.client.phone && (
                  <a href={`tel:${detail.client.phone.replace(/[^+\d]/g, "")}`} aria-label={labels.callClient} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white active:scale-95">
                    <Phone size={16} />
                  </a>
                )}
              </div>
            )}

            {/* ── Products ── */}
            <div className="flex items-center justify-between px-1 pt-1 text-xs font-black">
              <span className="flex items-center gap-1.5"><Package size={14} className="text-(--brand-600)" />{labels.invItems}
                <span className="rounded-full bg-(--bg-sunken) px-2 py-0.5 text-[11px] tabular-nums">{v.lines.length}</span>
              </span>
              {v.packs > 0 && <span className="opacity-60">{labels.packs}: <bdi className="tabular-nums">{dz(v.packs, 0)}</bdi></span>}
            </div>
            <div className="max-h-[calc(var(--vh)*0.4)] space-y-2 overflow-y-auto pe-0.5">
              {v.lines.length === 0 && <p className="p-4 text-center text-sm opacity-60">{labels.invNoLines}</p>}
              {v.lines.map(({ l, unit, base, pack, f, qty, pieces }, i) => {
                const imgs = l.product?.images?.map((x) => x.url) ?? phoneImages.get(l.productId) ?? [];
                const gift = !!l.isBonus;
                return (
                  <div
                    key={l.id ?? i}
                    className={cn("gw-rise flex items-center gap-3 rounded-2xl border p-2.5", gift ? "border-emerald-500/40 bg-emerald-500/10" : "border-(--border-default) bg-(--bg-surface)")}
                    style={{ animationDelay: `${Math.min(i, 10) * 45 + 100}ms` }}
                  >
                    <ProductThumb name={l.product?.name ?? ""} images={imgs} className="h-14 w-14 shrink-0 rounded-xl" />
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 break-words text-sm font-black leading-tight">
                        {l.product?.name ?? ""}
                        {gift && <span className="ms-1.5 inline-flex items-center gap-0.5 rounded-full bg-emerald-600 px-1.5 py-px align-middle text-[9px] font-black uppercase text-white"><Star size={9} />{t3("free")}</span>}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-bold tabular-nums" dir="ltr">
                        <span className="rounded-md bg-(--bg-sunken) px-1.5 py-0.5"><bdi>{dz(qty)}</bdi> {unit}</span>
                        <span className="opacity-50">×</span>
                        <span className="rounded-md bg-(--bg-sunken) px-1.5 py-0.5">{dzMoney(Number(l.unitPrice))}</span>
                      </div>
                      {pack && (
                        <div className="mt-1 text-[10.5px] font-bold text-(--brand-600)">
                          <bdi>1 {unit}</bdi> = <bdi>{f} {base}</bdi>{qty > 0 && <> · <bdi>{dz(pieces)} {labels.invPieces}</bdi></>}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-end text-sm font-black tabular-nums" dir="ltr">{gift ? "0" : dzMoney(Number(l.lineTotal))}</div>
                  </div>
                );
              })}
            </div>

            {/* ── Totals ── */}
            <div className="overflow-hidden rounded-2xl border border-(--border-default) bg-(--bg-surface)">
              {v.remise > 0 && (
                <Row label={labels.remise} value={`− ${dzMoney(v.remise)}`} />
              )}
              <Row label={labels.total} value={dzMoney(v.total)} strong />
              <Row label={labels.paid} value={dzMoney(v.paid)} />
              <div className={cn("flex items-center justify-between border-t border-dashed border-(--border-default) px-3 py-2.5 text-sm font-black", v.settled ? "bg-emerald-600/10 text-emerald-600" : "bg-red-500/10 text-red-600")}>
                <span className="flex items-center gap-1.5">{v.settled && <BadgeCheck size={16} />}{v.settled ? labels.invSettled : labels.invRemaining}</span>
                {!v.settled && <span className="tabular-nums" dir="ltr">{dzMoney(v.remaining)}</span>}
              </div>
            </div>
            {detail.notes && (
              <p className="rounded-xl bg-(--bg-sunken) px-3 py-2 text-xs font-bold"><span className="opacity-60">{labels.notes}: </span>{detail.notes}</p>
            )}

            {/* ── Actions ── */}
            <div className="grid grid-cols-[auto_auto_1fr] gap-2 pt-1">
              <Button variant="secondary" onClick={onClose} aria-label={labels.invClose}><X size={16} /></Button>
              <Button variant="secondary" onClick={() => void openPreview(true)} data-testid="pv-share" aria-label={ticketLabels.share}><Share2 size={16} /></Button>
              <Button onClick={() => void openPreview(false)} data-testid="pv-print"><Printer size={16} className="me-1.5" />{labels.print}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Ticket print preview (portal above the sheet) ── */}
      {preview && ticket && typeof document !== "undefined" && createPortal(
        <div className="ticket-print-scope fixed inset-0 z-[95] overflow-y-auto bg-black/60 p-3">
          <div className="mx-auto w-fit max-w-full">
            <div className="overflow-hidden rounded-2xl bg-white shadow-2xl">
              <TicketView ticket={ticket} company={co?.company ?? { name: "" }} width={co?.width ?? "80"} locale={locale} labels={ticketLabels} qrDataUrl={qr} lang={ticketLang} />
            </div>
            <div className="no-print mx-auto mt-2 flex max-w-full gap-2 pb-6" style={{ width: `${co?.width ?? "80"}mm` }}>
              <Button variant="secondary" onClick={() => { setPreview(false); setPdfView(false); }} className="flex-1" aria-label={labels.invClose}><X size={16} /></Button>
              <Button variant="secondary" onClick={() => setPdfView(true)} className="flex-1"><Share2 size={16} className="me-1" />{ticketLabels.share}</Button>
              <Button onClick={() => void doPrint()} className="flex-[2]"><Printer size={16} className="me-1" />{labels.print}</Button>
            </div>
            {msg && <div className="no-print mx-auto max-w-full pb-2 text-center text-xs font-bold text-white/90" style={{ width: `${co?.width ?? "80"}mm` }}>{msg}</div>}
            {pdfView && (
              <PdfViewer
                ticket={ticket}
                company={{ name: co?.company.name ?? "", phone: co?.company.phone ?? null, address: co?.company.address ?? null, rc: co?.company.rc ?? null, nif: co?.company.nif ?? null, nis: co?.company.nis ?? null, logoUrl: co?.company.logoUrl ?? null }}
                lang={ticketLang}
                labels={ticketLabels}
                qrDataUrl={qr}
                onClose={() => setPdfView(false)}
              />
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between border-b border-dashed border-(--border-default) px-3 py-2 last:border-b-0", strong ? "bg-(--brand-500)/10 text-base font-black" : "text-sm font-bold")}>
      <span className={strong ? "" : "opacity-70"}>{label}</span>
      <span className="tabular-nums" dir="ltr">{value}</span>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="h-36 animate-pulse rounded-3xl bg-(--bg-sunken)" />
      <div className="h-14 animate-pulse rounded-2xl bg-(--bg-sunken)" />
      {[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-(--bg-sunken)" style={{ animationDelay: `${i * 90}ms` }} />)}
    </div>
  );
}
