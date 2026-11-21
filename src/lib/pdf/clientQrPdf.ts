"use client";

/// Client QR cards → square ticket PDF (60/80/100mm), one card per page.
/// Each framed card has: company banner, a vector QR (error
/// correction H) with the full company logo in the centre, client name,
/// and the client's phone in small black text under it.
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

const QR_LOGO_URL = "/icons/qr-logo-v2.png";

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

  // The white-background brand logo is the QR centre; company logo is the fallback.
  const logo =
    (await urlToDataUrl(QR_LOGO_URL)) ?? (company.logoUrl ? await urlToDataUrl(company.logoUrl) : null);
  const logoDim = logo ? await imageSize(logo.data) : null;

  const fm = 1.5 * k; // paper edge → frame
  const cardW = S - fm * 2;
  const innerW = cardW - 8 * k;
  const bannerH = 13 * k;
  const qrSize = 47 * k;

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
    fit(nm, 17 * k, cardW - 6 * k, 7);
    doc.text(nm, cx, by + bannerH / 2 + 2 * k, { align: "center" });
    // Company phone sits under the black bar, above the QR.
    if (company.phone) {
      doc.setFont("courier", "bold");
      doc.setFontSize(8 * k);
      doc.setTextColor(0, 0, 0);
      doc.text(company.phone, cx, by + bannerH + 3.8 * k, { align: "center" });
    }

    // ── QR (vector, level H) ──
    const qx = cx - qrSize / 2;
    const qy = by + bannerH + (company.phone ? 5.4 : 2) * k;
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

    // ── Centre: the full logo, uncropped, on a white plate ──
    if (logo && logoDim && l.payload) {
      const ratio = logoDim.w / logoDim.h;
      const box = qrSize * 0.34; // long side; verified scannable (jsQR) at 60/80/100mm; 0.42+ starts failing
      const lw = ratio >= 1 ? box : box * ratio;
      const lh = ratio >= 1 ? box / ratio : box;
      const pcx = qx + qrSize / 2;
      const pcy = qy + qrSize / 2;
      const pad = 1 * k;
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(pcx - lw / 2 - pad, pcy - lh / 2 - pad, lw + pad * 2, lh + pad * 2, 2 * k, 2 * k, "F");
      try {
        doc.addImage(logo.data, logo.format, pcx - lw / 2, pcy - lh / 2, lw, lh);
      } catch {
        /* ignore */
      }
    }

    // ── Client name (one line, shrunk to fit) ──
    let hy = qy + qrSize + 4.4 * k;
    doc.setFont(F, "bold");
    doc.setTextColor(0, 0, 0);
    const name = T(l.name);
    fit(name, 11 * k, innerW, 6);
    const nameLine = (doc.splitTextToSize(name, innerW) as string[])[0] ?? name;
    doc.text(nameLine, cx, hy, { align: "center" });
    hy += 1.6 * k;

    // ── Client phone: small plain black text under the name ──
    if (l.phone) {
      doc.setFont("courier", "bold");
      doc.setTextColor(0, 0, 0);
      fit(l.phone, 9.5 * k, innerW, 6);
      doc.text(l.phone, cx, hy + 1.8 * k, { align: "center" });
    }
  });

  return doc.output("blob");
}

export async function qrLabelsPdfUrl(input: QrLabelsPdfInput): Promise<string> {
  const blob = await buildQrLabelsPdf(input);
  return URL.createObjectURL(blob);
}
