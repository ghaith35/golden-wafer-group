import { Fragment } from "react";
import { dz, dzMoney } from "@/lib/format";
import { TICKET_HERO, TICKET_HERO_RATIO } from "@/lib/brand/ticketHero";

/// Shared thermal ticket (80mm paper, 72mm printable), Arabic RTL.
/// Rendered both by the print page (server) and the post-sale preview popup
/// (client) — same component, so preview === printed output.
/// No hooks: safe in server and client components alike.

export type TicketLineVM = {
  name: string;
  qty: number | string;
  baseQty?: number | string | null;
  unitPrice: number | string;
  lineTotal: number | string;
  /// 3pack free-colis line: shown at 0 with a "free" tag, qty kept.
  bonus?: boolean;
};

export type TicketVM = {
  number: string;
  date: string | Date;
  total: number | string;
  paid: number | string;
  remise?: number | string | null;
  /// Debt before this ticket (computed by the caller: print page reads the
  /// balance after posting, the live preview reads it before).
  oldDebt?: number | string | null;
  newDebt?: number | string | null;
  client?: { name: string; code?: string | null; phone?: string | null; tierName?: string | null } | null;
  location?: { name: string } | null;
  seller?: string | null;
  sellerPhone?: string | null;
  lines: TicketLineVM[];
};

export type TicketCompanyVM = {
  name: string;
  phone?: string | null;
  address?: string | null;
  rc?: string | null;
  nif?: string | null;
  logoUrl?: string | null;
};

export type TicketLabels = {
  total: string;
  paid: string;
  due: string;
  remise: string;
  thanks: string;
  seller: string;
  client: string;
  share: string;
  packs: string;
  articles: string;
  oldDebt: string;
  newDebt: string;
  design: string;
  qty: string;
  price: string;
  unitPrice: string;
  /// Share feedback (optional so older call sites keep compiling).
  copied?: string;
  shareFail?: string;
  pdfSaved?: string;
  pdfShared?: string;
  printFail?: string;
  pdfPreview?: string;
  save?: string;
};

const num = (v: number | string | null | undefined): number => Number(v ?? 0);

function fmtDate(d: string | Date, locale: string): string {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.toLocaleDateString(locale)} · ${dt.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`;
}

/// Pack factor for a line (e.g. 1 carton × [24]): base units per sale unit.
function packFactor(l: TicketLineVM): number {
  const q = num(l.qty);
  const b = num(l.baseQty);
  if (!q || !b) return 1;
  const f = Math.round((b / q) * 1000) / 1000;
  return f > 1 ? f : 1;
}

export function TicketView({
  ticket,
  company,
  width,
  locale,
  labels,
  qrDataUrl,
  lang,
}: {
  ticket: TicketVM;
  company: TicketCompanyVM;
  width: "80";
  locale: string;
  labels: TicketLabels;
  qrDataUrl?: string | null;
  /// Ticket language: "ar" (RTL) or "fr" (LTR). Layout flips via logical
  /// CSS properties; labels come pre-translated.
  lang?: "ar" | "fr";
}) {
  const total = num(ticket.total);
  const paid = num(ticket.paid);
  const remise = num(ticket.remise);
  const due = total - paid;
  // dzMoney already carries the DA suffix — never append currency again.
  const money = (v: number) => dzMoney(v);
  const packs = ticket.lines.reduce((s, l) => {
    const f = packFactor(l);
    return s + (f > 1 ? num(l.qty) : 0);
  }, 0);
  const showDebts = ticket.client != null && (ticket.oldDebt != null || ticket.newDebt != null);
  return (
    <div
      dir={lang === "fr" ? "ltr" : "rtl"}
      className="ticket bg-white text-black"
      style={{ width: `${width}mm`, fontFamily: "inherit" }}
    >
      {/* 80mm roll: ~72mm printable → 4mm side padding keeps every edge off the head's dead zone */}
      <div className="text-center" style={{ padding: "2mm 4mm" }}>
        {/* ── Header: brand hero (truck + wordmark), then contact ── */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={TICKET_HERO}
          alt={company.name}
          width={560}
          height={Math.round(560 / TICKET_HERO_RATIO)}
          className="mx-auto block h-auto"
          style={{ width: "74%" }}
        />
        {!/golden\s*wafer/i.test(company.name) && <div className="mt-1 text-lg font-black leading-tight">{company.name}</div>}
        {company.address && <div className="mt-1 text-xs font-semibold opacity-80">{company.address}</div>}
        {company.phone && <div className="text-xs font-black" dir="ltr">{company.phone}</div>}
        {(company.rc || company.nif) && (
          <div className="text-[10px] opacity-70">
            {[company.rc && `RC: ${company.rc}`, company.nif && `NIF: ${company.nif}`].filter(Boolean).join(" · ")}
          </div>
        )}
        <Ornament />
        {/* ── Meta: number · van name · date, one row ── */}
        <div className="flex items-center justify-between gap-1 border-y-[3px] border-double border-black py-1 text-xs">
          <span className="shrink-0 text-xs font-black" dir="ltr">N° {ticket.number}</span>
          {ticket.location?.name && <span className="min-w-0 flex-1 text-center text-[11px] font-black leading-tight">{ticket.location.name}</span>}
          <span className="shrink-0 text-[11px] font-bold tabular-nums">{fmtDate(ticket.date, locale)}</span>
        </div>
        {ticket.client && (
          <div className="mt-1.5 rounded-lg border-2 border-black p-1.5 text-xs">
            <div className="text-sm font-black leading-tight">{labels.client}: <bdi dir="auto">{ticket.client.name}</bdi></div>
            <div className="font-bold opacity-70" dir="ltr">{ticket.client.code ?? ""}{ticket.client.phone ? ` · ${ticket.client.phone}` : ""}</div>
            {ticket.client.tierName && <div className="font-bold opacity-70">{ticket.client.tierName}</div>}
          </div>
        )}
        <Ornament />
        {/* ── Lines: Designation | Qte | P.U | Totale ── */}
        {/* ── Lines table: ONE shared grid so the header and every row
            use the exact same column tracks (same dividing everywhere).
            auto tracks size to the widest cell across all rows. ── */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] gap-x-0 text-[10px] tabular-nums">
          <span className="border-b border-dashed border-black/10 px-1 pb-0.5 text-start text-[9px] font-black opacity-60">{labels.design}</span>
          <span className="border-b border-dashed border-black/10 border-s border-dotted border-black/10 px-1 pb-0.5 text-center text-[9px] font-black opacity-60" dir="ltr">{labels.unitPrice}</span>
          <span className="border-b border-dashed border-black/10 border-s border-dotted border-black/10 px-1 pb-0.5 text-center text-[9px] font-black opacity-60">{labels.qty}</span>
          <span className="border-b border-dashed border-black/10 border-s border-dotted border-black/10 px-1 pb-0.5 text-center text-[9px] font-black opacity-60" dir="ltr">{labels.price}</span>
          <span className="border-b border-dashed border-black/10 border-s border-dotted border-black/10 px-1 pb-0.5 text-end text-[9px] font-black opacity-60" dir="ltr">{labels.total}</span>
          {ticket.lines.map((l, i) => {
            const f = packFactor(l);
            const b = num(l.baseQty);
            // Per-piece price from the line total (exact even with remise).
            const perPiece = b > 0 ? num(l.lineTotal) / b : f > 1 ? num(l.unitPrice) / f : 0;
            const lastRow = i === ticket.lines.length - 1;
            const rowBorder = lastRow ? "" : "border-b border-dotted border-black/10";
            return (
              <Fragment key={i}>
                <span className={`min-w-0 break-words px-1 py-1 text-start font-bold ${rowBorder}`}>
                  {l.name}
                  {l.bonus && <span className="block text-[9px] font-black uppercase">★ {lang === "fr" ? "Gratuit" : "مجاني"}</span>}
                </span>
              <span className={`whitespace-nowrap border-s border-dotted border-black/10 px-1 py-1 text-center ${rowBorder}`} dir="ltr">{f > 1 && perPiece > 0 ? money(perPiece) : "—"}</span>
              <span className={`whitespace-nowrap border-s border-dotted border-black/10 px-1 py-1 text-center ${rowBorder}`} dir="ltr">{dz(num(l.qty))}{f > 1 ? ` × [${f % 1 === 0 ? f : f.toFixed(2)}]` : ""}</span>
              <span className={`whitespace-nowrap border-s border-dotted border-black/10 px-1 py-1 text-center ${rowBorder}`} dir="ltr">{money(num(l.unitPrice))}</span>
              <span className={`whitespace-nowrap border-s border-dotted border-black/10 px-1 py-1 text-end font-black ${rowBorder}`} dir="ltr">{money(num(l.lineTotal))}</span>
              </Fragment>
            );
          })}
        </div>
        <div className="my-1 border-t border-dashed border-black" />
        {packs > 0 && (
          <div className="flex items-center justify-between text-[11px] font-bold opacity-70">
            <span>{labels.packs}: {dz(packs, 0)}</span>
            <span>{labels.articles}: {ticket.lines.length}</span>
          </div>
        )}
        {/* ── Totals (dashed line between each row) ── */}
        {remise > 0 && (
          <div className="flex items-center justify-between border-b border-dashed border-black/40 pb-0.5 text-xs">
            <span>{labels.remise}</span>
            <span dir="ltr">− {money(remise)}</span>
          </div>
        )}
        {/* ── Summary: net · old debt · paid · new debt (or remaining) ── */}
        <div className="my-1 rounded-lg border-[3px] border-double border-black">
          <div className="flex items-center justify-between gap-2 border-b-2 border-black px-2 py-1.5 text-lg font-black">
            <span className="min-w-0 whitespace-nowrap">{lang === "fr" ? "NET À PAYER" : "الصافي للدفع"}</span>
            <span className="shrink-0 tabular-nums" dir="ltr">{money(total)}</span>
          </div>
          {showDebts && (
            <div className="flex items-center justify-between gap-2 border-b border-dashed border-black/60 px-2 py-1 text-sm font-bold">
              <span className="min-w-0">{lang === "fr" ? "DETTE ANCIENNE" : "الدين القديم"}</span>
              <span className="shrink-0 tabular-nums" dir="ltr">{money(num(ticket.oldDebt))}</span>
            </div>
          )}
          <div className={`flex items-center justify-between gap-2 px-2 py-1 text-sm font-bold ${showDebts ? "border-b-2 border-black" : "border-b border-dashed border-black/60"}`}>
            <span className="min-w-0">{lang === "fr" ? "MONTANT PAYÉ" : "المبلغ المدفوع"}</span>
            <span className="shrink-0 tabular-nums" dir="ltr">{money(paid)}</span>
          </div>
          <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-base font-black">
            <span className="min-w-0 whitespace-nowrap">{showDebts ? (lang === "fr" ? "NOUVELLE DETTE" : "الدين الجديد") : labels.due}</span>
            <span className="shrink-0 tabular-nums" dir="ltr">{money(showDebts ? num(ticket.newDebt) : due)}</span>
          </div>
        </div>
        <Ornament />
        {qrDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrDataUrl} alt={ticket.number} className="mx-auto h-20 w-20" />
        )}
        <div className="mt-1 text-sm font-black tracking-wide">✦ {labels.thanks} ✦</div>
        {/* 1 cm of blank paper under the thank-you (tear-off margin). */}
        <div aria-hidden style={{ height: "10mm" }} />
      </div>
      <style>{`.ticket, .ticket * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      @media print {
        body.ticket-printing > *:not(.ticket-print-scope) { display: none !important; }
        body.ticket-printing { background: #fff !important; margin: 0 !important; }
        body.ticket-printing .ticket-print-scope { position: static !important; background: #fff !important; padding: 0 !important; margin: 0 !important; overflow: visible !important; height: auto !important; max-height: none !important; }
        body.ticket-printing .no-print { display: none !important; }
        .ticket { width: ${width}mm !important; }
      } @page { size: ${width}mm auto; margin: 0; }`}</style>
    </div>
  );
}

/// Ruled divider with a centre diamond (prints crisp on thermal paper).
function Ornament() {
  return (
    <div className="my-1.5 flex items-center gap-1.5" aria-hidden>
      <span className="h-[2px] flex-1 bg-black" />
      <span className="text-[10px] leading-none">◆</span>
      <span className="h-[2px] flex-1 bg-black" />
    </div>
  );
}
