"use client";

/// Van stock sheet → real PDF (jsPDF), opened in-app like the proforma app.
///
/// Arabic has no native shaping in jsPDF, so text goes through
/// run-based bidi + presentation-forms reshaping, rendered with the Amiri
/// font (fetched once from /public/fonts, cached in memory). Everything
/// (fonts, logo, signature, stamp) degrades gracefully offline.

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { applyArabicFont, loadArabicFont, pdfAr, urlToDataUrl } from "./arabicPdf";
import type { SheetCompany, SheetRow } from "@/app/[locale]/(app)/vans/stock/VanSheet";

export type VanSheetPdfInput = {
  van: { name: string; matricule: string | null };
  driverName: string;
  company: SheetCompany;
  currency: string;
  date: string;
  rows: SheetRow[];
  totals: { units: number; value: number };
  labels: Record<string, string>;
};

function money(v: number, currency: string): string {
  const n = v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${n} ${currency}` : n;
}

export async function buildVanSheetPdf(input: VanSheetPdfInput): Promise<Blob> {
  const { van, driverName, company, currency, date, rows, totals, labels } = input;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const right = pageW - margin;

  const F = applyArabicFont(doc, await loadArabicFont());
  const T = (s: string) => (F === "Amiri" ? pdfAr(s) : s);

  // ── Header: company (right) + logo ──────────────────────────────────────
  let y = 16;
  const logo = company.logoUrl ? await urlToDataUrl(company.logoUrl) : null;
  doc.setFont(F, "bold");
  doc.setFontSize(17);
  doc.setTextColor(25, 60, 20);
  doc.text(T(company.name), right, y, { align: "right" });
  y += 6;
  doc.setFont(F, "normal");
  doc.setFontSize(9);
  doc.setTextColor(70, 70, 70);
  const sub: string[] = [];
  if (company.address) sub.push(company.address);
  if (company.phone) sub.push(`Tél: ${company.phone}`);
  const fiscal = [company.rc && `RC: ${company.rc}`, company.nif && `NIF: ${company.nif}`, company.ai && `AI: ${company.ai}`]
    .filter(Boolean)
    .join(" · ");
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

  // ── Title band ──────────────────────────────────────────────────────────
  y += 3;
  doc.setFillColor(54, 83, 20);
  doc.rect(margin, y, pageW - 2 * margin, 10, "F");
  doc.setFont(F, "bold");
  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.text(T(labels.sheet), pageW / 2, y + 7, { align: "center" });
  y += 15;

  // ── Van / driver / date ─────────────────────────────────────────────────
  doc.setFont(F, "bold");
  doc.setFontSize(10);
  doc.setTextColor(20, 20, 20);
  doc.text(T(`${van.name} · ${matricule(van)}`), right, y, { align: "right" });
  y += 5.5;
  doc.setFont(F, "normal");
  doc.setFontSize(9);
  doc.setTextColor(70, 70, 70);
  doc.text(T(`${labels.driver}: ${driverName}`), right, y, { align: "right" });
  y += 5;
  doc.text(T(`${labels.date}: ${date}`), right, y, { align: "right" });
  y += 7;

  // ── Table (columns reversed = RTL reading order) ────────────────────────
  const head = [
    T(labels.value),
    T(labels.units),
    T(labels.colisage),
    T(labels.reference),
    T(labels.product),
    "#",
  ].map((h) => ({ content: h, styles: { halign: "right" as const } }));
  const body = rows.map((r, i) => [
    { content: T(money(r.value, currency)), styles: { halign: "right" as const } },
    { content: T(r.units), styles: { halign: "right" as const } },
    { content: T(r.colis), styles: { halign: "right" as const } },
    { content: r.reference, styles: { halign: "right" as const } },
    { content: T(r.name), styles: { halign: "right" as const } },
    { content: String(i + 1), styles: { halign: "center" as const } },
  ]);

  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    styles: { font: F, fontSize: 9, textColor: [25, 25, 25], cellPadding: 2 },
    headStyles: { font: F, fontStyle: "bold", fillColor: [54, 83, 20], textColor: 255, halign: "right" },
    alternateRowStyles: { fillColor: [245, 247, 240] },
    margin: { left: margin, right: margin },
    didDrawPage: () => {
      doc.setFont(F, "normal");
      doc.setFontSize(8);
      doc.setTextColor(140, 140, 140);
      const n = doc.getNumberOfPages();
      doc.text(
        T(`${labels.page ?? "Page"} ${doc.getCurrentPageInfo().pageNumber} / ${n}`),
        pageW / 2,
        pageH - 10,
        { align: "center" }
      );
    },
  });

  // ── Totals ──────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const endY = (doc as any).lastAutoTable.finalY + 4;
  doc.setFont(F, "bold");
  doc.setFontSize(10);
  doc.setTextColor(20, 20, 20);
  doc.text(
    T(`${labels.total}: ${totals.units.toLocaleString("en-US", { maximumFractionDigits: 0 })} · ${money(totals.value, currency)}`),
    right,
    endY,
    { align: "right" }
  );

  // ── Signature / stamp ───────────────────────────────────────────────────
  const [sig, stamp] = await Promise.all([
    company.signatureUrl ? urlToDataUrl(company.signatureUrl) : null,
    company.stampUrl ? urlToDataUrl(company.stampUrl) : null,
  ]);
  const sy = endY + 14;
  if (sig) {
    try {
      doc.addImage(sig.data, sig.format, right - 45, sy, 45, 18);
    } catch {
      /* ignore */
    }
  }
  if (stamp) {
    try {
      doc.addImage(stamp.data, stamp.format, right - 50, sy + (sig ? 20 : 0), 34, 34);
    } catch {
      /* ignore */
    }
  }
  void sy;

  return doc.output("blob");
}

function matricule(van: { matricule: string | null }): string {
  return van.matricule ?? "";
}

export async function vanSheetPdfUrl(input: VanSheetPdfInput): Promise<string> {
  const blob = await buildVanSheetPdf(input);
  return URL.createObjectURL(blob);
}
