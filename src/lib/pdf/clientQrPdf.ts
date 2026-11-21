"use client";

/// Client QR cards → square ticket PDF (60/80/100mm), one card per page.
/// Each framed card has: company banner, a vector QR (error
/// correction H) with the company logo large in the centre, client name,
/// the client's phone in a bold pill, and the client code.
/// Arabic shaped with Amiri (same shared helpers as the van sheet).

import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { applyArabicFont, loadArabicFont, pdfAr, urlToDataUrl } from "./arabicPdf";

export type QrLabelInput = {
  id: string;
  code: string;
  name: string;
  phone?: string | null;
  /// Raw QR payload; drawn as vectors at level H so the logo can cover the centre.
  payload?: string;
  dataUrl: string;
};

export type QrLabelsPdfInput = {
  company: { name: string; phone: string | null; logoUrl: string | null };
  labels: QrLabelInput[];
  widthMm: 60 | 80 | 100;
};

function imageSize(src: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function buildQrLabelsPdf(input: QrLabelsPdfInput): Promise<Blob> {
  const { company, labels, widthMm } = input;
  const S = widthMm; // square ticket: S × S mm, one card per page
  const k = S / 80; // every dimension below is designed at 80mm and scaled

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: [S, S] });
  const F = applyArabicFont(doc, await loadArabicFont());
  const T = (s: string) => (F === "Amiri" ? pdfAr(s) : s);
  const cx = S / 2;

  const logo = company.logoUrl ? await urlToDataUrl(company.logoUrl) : null;
  const logoDim = logo ? await imageSize(logo.data) : null;

  const fm = 1.5 * k; // paper edge → frame
  const cardW = S - fm * 2;
  const innerW = cardW - 8 * k;
  const bannerH = 10 * k;
  const qrSize = 40 * k;

  const fit = (text: string, fs: number, maxW: number, min: number) => {
    doc.setFontSize(fs);
    while (fs > min && doc.getTextWidth(text) > maxW) {
      fs -= 0.5;
      doc.setFontSize(fs);
    }
    return fs;
  };

  labels.forEach((l, idx) => {
    if (idx > 0) doc.addPage([S, S], "portrait");
    const top = fm;

    // ── Frame (double line, rounded) ──
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.7 * k);
    doc.roundedRect(fm, top, cardW, cardW, 3 * k, 3 * k, "S");
    doc.setLineWidth(0.2 * k);
    doc.roundedRect(fm + 1.2 * k, top + 1.2 * k, cardW - 2.4 * k, cardW - 2.4 * k, 2.2 * k, 2.2 * k, "S");

    // ── Banner: solid black, company name in white ──
    const bx = fm + 1.2 * k;
    const by = top + 1.2 * k;
    doc.setFillColor(0, 0, 0);
    doc.roundedRect(bx, by, cardW - 2.4 * k, bannerH, 2.2 * k, 2.2 * k, "F");
    doc.rect(bx, by + bannerH - 3 * k, cardW - 2.4 * k, 3 * k, "F");
    doc.setFont(F, "bold");
    doc.setTextColor(255, 255, 255);
    const nm = T(company.name.toUpperCase());
    fit(nm, 11.5 * k, cardW - 8 * k, 6);
    doc.text(nm, cx, by + bannerH / 2 + (company.phone ? -0.2 * k : 1.3 * k), { align: "center" });
    if (company.phone) {
      doc.setFont("courier", "bold");
      doc.setFontSize(7 * k);
      doc.setTextColor(220, 220, 220);
      doc.text(company.phone, cx, by + bannerH / 2 + 3.3 * k, { align: "center" });
    }

    // ── QR (vector, level H) ──
    const qx = cx - qrSize / 2;
    const qy = by + bannerH + 2.5 * k;
    if (l.payload) {
      const qr = QRCode.create(l.payload, { errorCorrectionLevel: "H" });
      const n = qr.modules.size;
      const quiet = 1;
      const cell = qrSize / (n + quiet * 2);
      const data = qr.modules.data as ArrayLike<number>;
      doc.setFillColor(255, 255, 255);
      doc.rect(qx, qy, qrSize, qrSize, "F");
      doc.setFillColor(0, 0, 0);
      const inFinder = (r: number, c: number) =>
        (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (!data[r * n + c] || inFinder(r, c)) continue;
          doc.rect(qx + (c + quiet) * cell, qy + (r + quiet) * cell, cell + 0.04, cell + 0.04, "F");
        }
      }
      for (const [fr, fc] of [[0, 0], [0, n - 7], [n - 7, 0]] as const) {
        const ex = qx + (fc + quiet) * cell;
        const ey = qy + (fr + quiet) * cell;
        doc.setFillColor(0, 0, 0);
        doc.roundedRect(ex, ey, cell * 7, cell * 7, cell * 1.6, cell * 1.6, "F");
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(ex + cell, ey + cell, cell * 5, cell * 5, cell * 1.1, cell * 1.1, "F");
        doc.setFillColor(0, 0, 0);
        doc.roundedRect(ex + cell * 2, ey + cell * 2, cell * 3, cell * 3, cell * 0.8, cell * 0.8, "F");
      }
    } else {
      doc.addImage(l.dataUrl, "PNG", qx, qy, qrSize, qrSize);
    }

    // ── Centre medallion with the big logo ──
    if (logo && logoDim && l.payload) {
      const plate = qrSize * 0.4; // ≈13% of the area, well inside level-H recovery (30%)
      const pcx = qx + qrSize / 2;
      const pcy = qy + qrSize / 2;
      doc.setFillColor(255, 255, 255);
      doc.circle(pcx, pcy, plate / 2 + 0.8 * k, "F");
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.5 * k);
      doc.circle(pcx, pcy, plate / 2, "S");
      const box = plate * 0.9;
      const ratio = logoDim.w / logoDim.h;
      const lw = ratio >= 1 ? box : box * ratio;
      const lh = ratio >= 1 ? box / ratio : box;
      try {
        doc.addImage(logo.data, logo.format, pcx - lw / 2, pcy - lh / 2, lw, lh);
      } catch {
        /* ignore */
      }
    }

    // ── Client name (one line, shrunk to fit) ──
    let hy = qy + qrSize + 5.3 * k;
    doc.setFont(F, "bold");
    doc.setTextColor(0, 0, 0);
    const name = T(l.name);
    fit(name, 11 * k, innerW, 6);
    const nameLine = (doc.splitTextToSize(name, innerW) as string[])[0] ?? name;
    doc.text(nameLine, cx, hy, { align: "center" });
    hy += 2.3 * k;

    // ── Client phone in a bold pill ──
    if (l.phone) {
      doc.setFont("courier", "bold");
      const pfs = fit(l.phone, 13 * k, innerW - 9 * k, 7);
      const tw = doc.getTextWidth(l.phone);
      const pw = tw + 9 * k;
      const ph = 6.6 * k;
      doc.setFillColor(0, 0, 0);
      doc.roundedRect(cx - pw / 2, hy, pw, ph, ph / 2, ph / 2, "F");
      doc.setTextColor(255, 255, 255);
      doc.text(l.phone, cx, hy + ph / 2 + pfs * 0.14, { align: "center" });
      hy += ph + 1.2 * k;
    }

    // ── Code with ornament rules ──
    doc.setFont("courier", "bold");
    doc.setFontSize(8 * k);
    doc.setTextColor(0, 0, 0);
    doc.setCharSpace(0.5 * k);
    const cw = doc.getTextWidth(l.code) + l.code.length * 0.5 * k;
    doc.text(l.code, cx - cw / 2, hy + 3 * k);
    doc.setCharSpace(0);
    doc.setLineWidth(0.25 * k);
    doc.setDrawColor(0, 0, 0);
    const ly = hy + 2.1 * k;
    const rule = Math.max(0, (innerW - cw) / 2 - 4 * k);
    if (rule > 2) {
      doc.line(cx - cw / 2 - 3 * k - rule, ly, cx - cw / 2 - 3 * k, ly);
      doc.line(cx + cw / 2 + 3 * k, ly, cx + cw / 2 + 3 * k + rule, ly);
    }
  });

  return doc.output("blob");
}

export async function qrLabelsPdfUrl(input: QrLabelsPdfInput): Promise<string> {
  const blob = await buildQrLabelsPdf(input);
  return URL.createObjectURL(blob);
}
