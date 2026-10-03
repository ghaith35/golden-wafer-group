"use client";

/// Client QR labels → thermal PDF (58/80mm rolls), opened in-app.
/// One label under the other: company + phone, big QR, client name + code.
/// Arabic shaped with Amiri (same shared helpers as the van sheet).

import { jsPDF } from "jspdf";
import { applyArabicFont, loadArabicFont, pdfAr, urlToDataUrl } from "./arabicPdf";

export type QrLabelInput = {
  id: string;
  code: string;
  name: string;
  dataUrl: string;
};

export type QrLabelsPdfInput = {
  company: { name: string; phone: string | null; logoUrl: string | null };
  labels: QrLabelInput[];
  widthMm: 58 | 80;
};

export async function buildQrLabelsPdf(input: QrLabelsPdfInput): Promise<Blob> {
  const { company, labels, widthMm } = input;
  const margin = 3;
  const contentW = widthMm - margin * 2;
  const qrSize = contentW;
  // Per-label height budget (header + qr + name + code + gaps + cut line).
  const labelH = 20 + qrSize + 16;
  const pageH = Math.max(60, margin * 2 + labels.length * (labelH + 3));

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: [widthMm, pageH] });
  const F = applyArabicFont(doc, await loadArabicFont());
  const T = (s: string) => (F === "Amiri" ? pdfAr(s) : s);
  const cx = widthMm / 2;

  const logo = company.logoUrl ? await urlToDataUrl(company.logoUrl) : null;

  let y = margin;
  for (const l of labels) {
    // Company header
    let hy = y;
    if (logo) {
      try {
        doc.addImage(logo.data, logo.format, cx - 9, hy, 8, 8);
        hy += 9;
      } catch {
        /* ignore */
      }
    }
    doc.setFont(F, "bold");
    doc.setFontSize(9);
    doc.setTextColor(10, 10, 10);
    doc.text(T(company.name), cx, hy + 4, { align: "center" });
    hy += 8;
    if (company.phone) {
      doc.setFont(F, "normal");
      doc.setFontSize(7);
      doc.setTextColor(90, 90, 90);
      doc.text(company.phone, cx, hy, { align: "center" });
      hy += 4;
    }

    // QR
    doc.addImage(l.dataUrl, "PNG", margin, hy, qrSize, qrSize);
    hy += qrSize + 2;

    // Client name + code
    doc.setFont(F, "bold");
    doc.setFontSize(9);
    doc.setTextColor(10, 10, 10);
    const nameLines = doc.splitTextToSize(T(l.name), contentW);
    doc.text(nameLines.slice(0, 2), cx, hy, { align: "center" });
    hy += 4 * Math.min(2, nameLines.length);
    doc.setFont("courier", "bold");
    doc.setFontSize(8);
    doc.text(l.code, cx, hy, { align: "center" });
    hy += 2;

    y = hy + 3;
    // Dashed cut line between labels (not after the last one)
    if (l !== labels[labels.length - 1]) {
      doc.setDrawColor(180, 180, 180);
      doc.setLineDashPattern([1, 1], 0);
      doc.line(margin, y, widthMm - margin, y);
      doc.setLineDashPattern([], 0);
      y += 3;
    }
  }

  return doc.output("blob");
}

export async function qrLabelsPdfUrl(input: QrLabelsPdfInput): Promise<string> {
  const blob = await buildQrLabelsPdf(input);
  return URL.createObjectURL(blob);
}
