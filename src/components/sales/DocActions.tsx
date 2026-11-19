"use client";

import { useState } from "react";
import { Download, Printer, Share2 } from "lucide-react";
import { savePdfFile, shareImageFile } from "@/lib/share-ticket";

const T = {
  fr: { print: "Imprimer", pdf: "Enregistrer PDF", share: "Partager (image)", working: "…", saved: "PDF enregistré ✓", shared: "Image partagée ✓", failed: "Échec" },
  ar: { print: "طباعة", pdf: "حفظ PDF", share: "مشاركة (صورة)", working: "…", saved: "تم حفظ PDF ✓", shared: "تمت المشاركة ✓", failed: "فشلت العملية" },
  en: { print: "Print", pdf: "Save PDF", share: "Share (image)", working: "…", saved: "PDF saved ✓", shared: "Image shared ✓", failed: "Failed" },
} as const;

/// Document toolbar: print, save as A4 PDF, share as image. The A4 sheet
/// (`.bl-sheet`) is rasterised in the browser — works offline, no server round-trip.
export function DocActions({ lang, fileName }: { lang: "fr" | "ar" | "en"; fileName: string }) {
  const t = T[lang];
  const [busy, setBusy] = useState<"" | "pdf" | "img">("");
  const [msg, setMsg] = useState("");

  async function snapshot() {
    const el = document.querySelector<HTMLElement>(".bl-sheet");
    if (!el) throw new Error("no sheet");
    const { toCanvas } = await import("html-to-image");
    // Fixed A4 width so the capture never depends on the pop-up size.
    const prev = { w: el.style.width, m: el.style.maxWidth, mg: el.style.margin, sh: el.style.boxShadow };
    el.style.width = "794px";
    el.style.maxWidth = "none";
    el.style.margin = "0";
    el.style.boxShadow = "none";
    try {
      return await toCanvas(el, { pixelRatio: 2, backgroundColor: "#ffffff", cacheBust: true, filter: (n) => !(n instanceof HTMLElement && n.classList.contains("print:hidden")) });
    } finally {
      el.style.width = prev.w;
      el.style.maxWidth = prev.m;
      el.style.margin = prev.mg;
      el.style.boxShadow = prev.sh;
    }
  }

  async function toast(m: string) {
    setMsg(m);
    window.setTimeout(() => setMsg(""), 2500);
  }

  async function savePdf() {
    setBusy("pdf");
    try {
      const canvas = await snapshot();
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      const pw = 210, ph = 297;
      const pxPerPage = Math.floor((canvas.width * ph) / pw);
      for (let y = 0, page = 0; y < canvas.height - 8; y += pxPerPage, page++) {
        const slice = document.createElement("canvas");
        slice.width = canvas.width;
        slice.height = Math.min(pxPerPage, canvas.height - y);
        slice.getContext("2d")!.drawImage(canvas, 0, y, canvas.width, slice.height, 0, 0, canvas.width, slice.height);
        if (page > 0) pdf.addPage();
        pdf.addImage(slice.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, pw, (slice.height * pw) / canvas.width);
      }
      const r = await savePdfFile({ fileName: `${fileName}.pdf`, blob: pdf.output("blob") });
      if (r !== "cancelled") await toast(r === "saved" ? t.saved : t.failed);
    } catch {
      await toast(t.failed);
    } finally {
      setBusy("");
    }
  }

  async function shareImg() {
    setBusy("img");
    try {
      const canvas = await snapshot();
      const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/png"));
      if (!blob) throw new Error("blob");
      const r = await shareImageFile({ fileName: `${fileName}.png`, blob, title: fileName });
      await toast(r === "failed" ? t.failed : t.shared);
    } catch {
      await toast(t.failed);
    } finally {
      setBusy("");
    }
  }

  const btn = "flex min-h-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-black shadow disabled:opacity-60";
  return (
    <div className="flex flex-wrap items-center gap-1.5" dir={lang === "ar" ? "rtl" : "ltr"}>
      {msg && <span className="rounded-lg bg-black/80 px-2.5 py-1.5 text-[11px] font-black text-white">{msg}</span>}
      <button type="button" onClick={() => void shareImg()} disabled={busy !== ""} className={`${btn} bg-white text-neutral-800`}>
        <Share2 size={14} />{busy === "img" ? t.working : t.share}
      </button>
      <button type="button" onClick={() => void savePdf()} disabled={busy !== ""} className={`${btn} bg-white text-neutral-800`}>
        <Download size={14} />{busy === "pdf" ? t.working : t.pdf}
      </button>
      <button type="button" onClick={() => window.print()} className={`${btn} bg-[#c9951a] text-white`}>
        <Printer size={14} />{t.print}
      </button>
    </div>
  );
}
