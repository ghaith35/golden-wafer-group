"use client";

/// Driver facture → real A4 PDF (jsPDF), saved or shared from the phone.
/// French monochrome business invoice: black/white only (prints perfectly on
/// any printer), company header with logo + settings info (name, address,
/// phone, RC, NIF), client band, ruled lines table, totals box, QR + footer.
/// Arabic shaping via Amiri (/fonts, SW-cached and warmed — offline-safe),
/// logo best-effort, everything else local. Product/client names keep their
/// original language — only the invoice wording is French.

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { applyArabicFont, loadArabicFont, pdfAr, urlToDataUrl } from "./arabicPdf";
import type { TicketVM } from "@/components/sales/TicketView";
import type { TicketCompany } from "@/lib/print-ticket";

const STR: Record<"ar" | "fr", { facture: string; client: string; date: string; van: string; product: string; qty: string; price: string; total: string; page: string }> = {
  ar: { facture: "فاتورة", client: "الزبون", date: "التاريخ", van: "الشاحنة", product: "المنتج", qty: "الكمية", price: "السعر", total: "المجموع", page: "صفحة" },
  fr: { facture: "Facture", client: "Client", date: "Date", van: "Camion", product: "Désignation", qty: "Qté", price: "P.U", total: "Total", page: "Page" },
};

/// Forced-French label set for the exported PDF (the UI may be Arabic —
/// the invoice file itself is always French).
export const FRENCH_LABELS = {
  total: "Total",
  paid: "Payé",
  due: "Reste",
  remise: "Remise",
  thanks: "Merci pour votre confiance",
  facture: "Facture",
  client: "Client",
  date: "Date",
  van: "Camion",
  product: "Désignation",
  qty: "Qté",
  price: "P.U",
};

/// French number format (1 500,00) with plain spaces — narrow-NBSP group
/// separators miss from some fonts and render as garbage. Pure Latin →
/// pdfAr passes it through.
function money(v: unknown): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "0,00";
  return n
    .toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/[  ]/g, " ");
}

function pdfDate(iso: unknown): string {
  try {
    const d = new Date(String(iso ?? ""));
    if (Number.isNaN(d.getTime())) return "";
    const p = (x: number) => String(x).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch {
    return "";
  }
}

export type TicketPdfInput = {
  ticket: TicketVM;
  company: TicketCompany;
  lang: "ar" | "fr";
  labels: {
    total: string; paid: string; due: string; remise: string; thanks?: string | null;
    facture?: string; client?: string; date?: string; van?: string;
    product?: string; qty?: string; price?: string;
  };
  qrDataUrl?: string | null;
};

const BLACK: [number, number, number] = [0, 0, 0];
const INK: [number, number, number] = [30, 30, 30];
const GREY: [number, number, number] = [90, 90, 90];
const LINE: [number, number, number] = [170, 170, 170];
const ZEBRA: [number, number, number] = [243, 243, 243];

export async function buildTicketPdf(input: TicketPdfInput): Promise<Blob> {
  const { ticket: t, company, lang, qrDataUrl } = input;
  const S = STR[lang] ?? STR.fr;
  const L = { ...S, ...(input.labels ?? {}) } as typeof S & { paid: string; due: string; remise: string; thanks?: string | null };
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const right = pageW - margin;

  const F = applyArabicFont(doc, await loadArabicFont());
  // RTL layout (everything starts from the right): full RTL-base shaping
  // for every string — pure French passes through untouched.
  const T = (s: string) => (F === "Amiri" ? pdfAr(s) : s);

  // ── Header: logo + company (right) · FACTURE block (left) ──────────────
  let y = 15;
  const logo = company.logoUrl ? await urlToDataUrl(company.logoUrl) : null;
  if (logo) {
    try {
      doc.addImage(logo.data, logo.format, right - 24, 11, 24, 24);
    } catch {
      /* ignore */
    }
  }
  doc.setFont(F, "bold");
  doc.setFontSize(19);
  doc.setTextColor(...BLACK);
  doc.text(T(company.name || ""), right - (logo ? 30 : 0), y, { align: "right" });
  y += 6;
  doc.setFont(F, "normal");
  doc.setFontSize(9);
  doc.setTextColor(...GREY);
  const infoX = right - (logo ? 30 : 0);
  if (company.address) {
    doc.text(T(company.address), infoX, y, { align: "right" });
    y += 4.5;
  }
  if (company.phone) {
    doc.text(T(`Tél : ${company.phone}`), infoX, y, { align: "right" });
    y += 4.5;
  }
  // Left: FACTURE title + number + date.
  doc.setFont(F, "bold");
  doc.setFontSize(24);
  doc.setTextColor(...BLACK);
  doc.text(T(L.facture.toUpperCase()), margin, 19);
  doc.setFontSize(12);
  doc.text(T(`N° ${t.number ?? ""}`), margin, 26);
  doc.setFont(F, "normal");
  doc.setFontSize(9);
  doc.setTextColor(...GREY);
  doc.text(T(`${L.date} : ${pdfDate(t.date)}`), margin, 31);
  y = Math.max(y, 36);

  // ── Client band (black) ────────────────────────────────────────────────
  doc.setFillColor(...BLACK);
  doc.rect(margin, y, pageW - 2 * margin, 9, "F");
  doc.setFont(F, "bold");
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  const clientLeft = t.client
    ? `${L.client} : ${t.client.name ?? ""}${t.client.code ? `  (${t.client.code})` : ""}${t.client.phone ? `  ·  ${t.client.phone}` : ""}`
    : `${L.client} : —`;
  doc.text(T(clientLeft), right - 3, y + 6, { align: "right" });
  if (t.location?.name) {
    doc.text(T(`${L.van} : ${t.location.name}`), margin + 3, y + 6);
  }
  y += 14;

  // ── Lines table (starts from the right: Total ··· #) ────────────────────
  const head = [T(`${L.total} (DA)`), T(`${L.price} (DA)`), T(L.qty), T(L.product), T("#")].map(
    (h, i) => ({
      content: h,
      styles: { halign: (i === 4 ? "center" : "right") as "center" | "right" },
    }),
  );
  const body = (t.lines ?? []).map((l, i) => [
    { content: money(l.lineTotal), styles: { halign: "right" as const } },
    { content: money(l.unitPrice), styles: { halign: "right" as const } },
    { content: String(l.qty ?? ""), styles: { halign: "right" as const } },
    { content: T(String(l.name ?? "") + (l.bonus ? (lang === "fr" ? " (Gratuit)" : " (مجاني)") : "")), styles: { halign: "right" as const } },
    { content: String(i + 1), styles: { halign: "center" as const } },
  ]);
  const footerCompany = T(company.name || "");
  const footerNum = T(`N° ${t.number ?? ""}`);
  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    styles: {
      font: F,
      fontSize: 10,
      textColor: [...INK],
      cellPadding: 2.8,
      lineColor: [...LINE],
      lineWidth: 0.1,
    },
    headStyles: {
      font: F,
      fontStyle: "bold",
      fillColor: [...BLACK],
      textColor: 255,
      lineColor: [...BLACK],
      lineWidth: 0.1,
    },
    alternateRowStyles: { fillColor: [...ZEBRA] },
    columnStyles: {
      0: { cellWidth: 34 },
      1: { cellWidth: 32 },
      2: { cellWidth: 22 },
      4: { cellWidth: 12 },
    },
    margin: { left: margin, right: margin },
    didDrawPage: () => {
      doc.setFont(F, "normal");
      doc.setFontSize(8);
      doc.setTextColor(...GREY);
      doc.text(footerCompany, right, pageH - 10, { align: "right" });
      const n = doc.getNumberOfPages();
      doc.text(
        T(`${L.page} ${doc.getCurrentPageInfo().pageNumber} / ${n}`),
        pageW / 2,
        pageH - 10,
        { align: "center" },
      );
      doc.text(footerNum, margin, pageH - 10);
    },
  });

  // ── Totals (left block, boxed Reste) ───────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ty = (doc as any).lastAutoTable.finalY + 7;
  const total = Number(t.total ?? 0);
  const paid = Number(t.paid ?? 0);
  const due = Math.round((total - paid) * 100) / 100;
  const row = (label: string, val: string, bold: boolean, size: number) => {
    doc.setFont(F, bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...(bold ? BLACK : INK));
    doc.text(T(`${label} : ${val} DA`), margin, ty);
    ty += size > 10 ? 7 : 5.5;
  };
  if (Number(t.remise ?? 0) > 0) row(String(L.remise ?? "Remise"), `- ${money(t.remise)}`, false, 10);
  row(String(L.total ?? "Total"), money(total), true, 12);
  row(String(L.paid ?? "Payé"), money(paid), false, 10);
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.4);
  doc.rect(margin, ty - 5, 78, 8);
  row(String(L.due ?? "Reste"), money(due), true, 12);

  // ── QR + thanks (new page if tight) ────────────────────────────────────
  if (ty > pageH - 62) {
    doc.addPage();
    ty = 22;
  }
  if (qrDataUrl) {
    try {
      doc.addImage(qrDataUrl, "PNG", pageW / 2 - 17, ty + 2, 34, 34);
      ty += 38;
    } catch {
      /* ignore */
    }
  }
  if (L.thanks) {
    doc.setFont(F, "bold");
    doc.setFontSize(11);
    doc.setTextColor(...BLACK);
    doc.text(T(String(L.thanks)), pageW / 2, ty + 5, { align: "center" });
  }

  return doc.output("blob");
}
