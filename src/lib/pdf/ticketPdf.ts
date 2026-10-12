"use client";

/// Driver facture → real A4 PDF (jsPDF), saved or shared from the phone.
/// Same stack as the van sheet: Arabic shaping via Amiri (/fonts, SW-cached
/// and warmed — offline-safe), logo best-effort, everything else local.
/// Works fully offline: all inputs (ticket/company/labels/QR) are in memory.

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { applyArabicFont, loadArabicFont, pdfAr, urlToDataUrl } from "./arabicPdf";
import type { TicketVM } from "@/components/sales/TicketView";
import type { TicketCompany } from "@/lib/print-ticket";

const STR: Record<"ar" | "fr", { facture: string; client: string; date: string; van: string; product: string; qty: string; price: string; total: string; page: string }> = {
  ar: { facture: "فاتورة", client: "الزبون", date: "التاريخ", van: "الشاحنة", product: "المنتج", qty: "الكمية", price: "السعر", total: "المجموع", page: "صفحة" },
  fr: { facture: "Facture", client: "Client", date: "Date", van: "Camion", product: "Produit", qty: "Qté", price: "Prix", total: "Total", page: "Page" },
};

function money(v: unknown): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pdfDate(iso: unknown, lang: "ar" | "fr"): string {
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

export async function buildTicketPdf(input: TicketPdfInput): Promise<Blob> {
  const { ticket: t, company, lang, qrDataUrl } = input;
  const S = STR[lang] ?? STR.ar;
  const L = { ...S, ...(input.labels ?? {}) } as typeof S & { paid: string; due: string; remise: string; thanks?: string | null };
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const right = pageW - margin;

  const F = applyArabicFont(doc, await loadArabicFont());
  const T = (s: string) => (F === "Amiri" ? pdfAr(s) : s);

  // ── Header: company (right) + logo (left) ────────────────────────────────
  let y = 16;
  const logo = company.logoUrl ? await urlToDataUrl(company.logoUrl) : null;
  doc.setFont(F, "bold");
  doc.setFontSize(17);
  doc.setTextColor(25, 60, 20);
  doc.text(T(company.name || ""), right, y, { align: "right" });
  y += 6;
  doc.setFont(F, "normal");
  doc.setFontSize(9);
  doc.setTextColor(70, 70, 70);
  const sub: string[] = [];
  if (company.address) sub.push(company.address);
  if (company.phone) sub.push(`Tél: ${company.phone}`);
  const fiscal = [company.rc && `RC: ${company.rc}`, company.nif && `NIF: ${company.nif}`].filter(Boolean).join(" · ");
  if (fiscal) sub.push(fiscal);
  for (const line of sub) {
    doc.text(T(line), right, y, { align: "right" });
    y += 4.5;
  }
  if (logo) {
    try {
      doc.addImage(logo.data, logo.format, margin, 12, 22, 22);
    } catch {
      /* ignore */
    }
  }

  // ── Title band: facture + number ─────────────────────────────────────────
  y += 3;
  doc.setFillColor(54, 83, 20);
  doc.rect(margin, y, pageW - 2 * margin, 10, "F");
  doc.setFont(F, "bold");
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text(T(`${L.facture} N° ${t.number ?? ""}`), pageW / 2, y + 7, { align: "center" });
  y += 15;

  // ── Client / date / van ──────────────────────────────────────────────────
  doc.setFont(F, "bold");
  doc.setFontSize(10);
  doc.setTextColor(20, 20, 20);
  if (t.client) {
    doc.text(T(`${L.client}: ${t.client.name ?? ""}${t.client.code ? ` (${t.client.code})` : ""}`), right, y, { align: "right" });
    y += 5.5;
    if (t.client.phone) {
      doc.setFont(F, "normal");
      doc.setFontSize(9);
      doc.setTextColor(70, 70, 70);
      doc.text(T(String(t.client.phone)), right, y, { align: "right" });
      y += 5;
      doc.setFont(F, "bold");
      doc.setFontSize(10);
      doc.setTextColor(20, 20, 20);
    }
  }
  doc.setFont(F, "normal");
  doc.setFontSize(9);
  doc.setTextColor(70, 70, 70);
  const meta = [`${L.date}: ${pdfDate(t.date, lang)}`];
  if (t.location?.name) meta.push(`${L.van}: ${t.location.name}`);
  for (const m of meta) {
    doc.text(T(m), right, y, { align: "right" });
    y += 5;
  }
  y += 2;

  // ── Lines table (columns reversed = RTL reading order) ───────────────────
  const head = [T(L.total), T(L.price), T(L.qty), T(L.product), "#"].map((h) => ({
    content: h,
    styles: { halign: "right" as const },
  }));
  const body = (t.lines ?? []).map((l, i) => [
    { content: money(l.lineTotal), styles: { halign: "right" as const } },
    { content: money(l.unitPrice), styles: { halign: "right" as const } },
    { content: String(l.qty ?? ""), styles: { halign: "right" as const } },
    { content: T(String(l.name ?? "")), styles: { halign: "right" as const } },
    { content: String(i + 1), styles: { halign: "center" as const } },
  ]);
  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    styles: { font: F, fontSize: 10, textColor: [25, 25, 25], cellPadding: 2.5 },
    headStyles: { font: F, fontStyle: "bold", fillColor: [54, 83, 20], textColor: 255, halign: "right" },
    alternateRowStyles: { fillColor: [245, 247, 240] },
    margin: { left: margin, right: margin },
    didDrawPage: () => {
      doc.setFont(F, "normal");
      doc.setFontSize(8);
      doc.setTextColor(140, 140, 140);
      const n = doc.getNumberOfPages();
      doc.text(T(`${L.page} ${doc.getCurrentPageInfo().pageNumber} / ${n}`), pageW / 2, pageH - 10, { align: "center" });
    },
  });

  // ── Totals ───────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ty = (doc as any).lastAutoTable.finalY + 6;
  const total = Number(t.total ?? 0);
  const paid = Number(t.paid ?? 0);
  const due = Math.round((total - paid) * 100) / 100;
  doc.setFontSize(10);
  doc.setTextColor(20, 20, 20);
  const row = (label: string, val: string, bold: boolean, color: [number, number, number] = [20, 20, 20]) => {
    doc.setFont(F, bold ? "bold" : "normal");
    doc.setTextColor(...color);
    doc.text(T(`${label}: ${val}`), right, ty, { align: "right" });
    ty += 5.5;
  };
  if (Number(t.remise ?? 0) > 0) row(String(L.remise ?? "Remise"), `− ${money(t.remise)}`, false);
  row(String(L.total ?? "Total"), money(total), true);
  row(String(L.paid ?? "Paid"), money(paid), false);
  row(String(L.due ?? "Due"), money(due), true, due > 0.005 ? [180, 30, 30] : [20, 20, 20]);

  // ── QR + thanks ──────────────────────────────────────────────────────────
  if (qrDataUrl) {
    try {
      doc.addImage(qrDataUrl, "PNG", pageW / 2 - 18, ty + 2, 36, 36);
      ty += 40;
    } catch {
      /* ignore */
    }
  }
  if (L.thanks) {
    doc.setFont(F, "bold");
    doc.setFontSize(10);
    doc.setTextColor(54, 83, 20);
    doc.text(T(String(L.thanks)), pageW / 2, ty + 4, { align: "center" });
  }

  return doc.output("blob");
}
