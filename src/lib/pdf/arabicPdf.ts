"use client";

/// Shared jsPDF helpers for Arabic documents (van sheets, QR labels…).
/// jsPDF has no Arabic shaping: text goes through run-based bidi +
/// presentation-forms reshaping, rendered with the Amiri font (fetched once
/// from /public/fonts, cached in memory). Everything degrades gracefully.

import type { jsPDF } from "jspdf";
import { convertArabic } from "arabic-reshaper";

const AR_RE = /[؀-ۿﹰ-﻿]/;

/// Visual-order string for jsPDF's LTR engine: token order is reversed and
/// Arabic tokens are reshaped, so "10 كرتون" renders exactly like the
/// browser does. Pure Latin/number strings pass through untouched.
///
/// Grouped numbers ("2 296", "2 296", "2,296") stay a single token so the
/// thousands group never flips to "296 2" after the reversal.
export function pdfAr(input: string): string {
  if (!AR_RE.test(input)) return input;
  // Glue any space between two digits (regular space, NBSP, narrow NBSP)
  // with a plain NBSP so the split below keeps "2 296" as one token.
  const glued = input.replace(/(\d)[ \u00A0\u202F](?=\d)/g, "$1 ");
  return glued
    .split(/ +/)
    .reverse()
    .map((tok) => (AR_RE.test(tok) ? convertArabic(tok) : tok))
    .join(" ");
}

export type FontPack = { reg: string; bold: string } | null;
let fontCache: FontPack | undefined;

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export async function loadArabicFont(): Promise<FontPack> {
  if (fontCache !== undefined) return fontCache;
  try {
    const [reg, bold] = await Promise.all([
      fetch("/fonts/amiri-regular.ttf").then((r) => {
        if (!r.ok) throw new Error("font");
        return r.arrayBuffer();
      }),
      fetch("/fonts/amiri-bold.ttf").then((r) => {
        if (!r.ok) throw new Error("font");
        return r.arrayBuffer();
      }),
    ]);
    fontCache = { reg: bufToB64(reg), bold: bufToB64(bold) };
  } catch {
    fontCache = null;
  }
  return fontCache;
}

/// Registers Amiri on the doc when available. Returns the font name to use.
export function applyArabicFont(doc: jsPDF, fonts: FontPack): string {
  if (!fonts) return "helvetica";
  doc.addFileToVFS("Amiri-Regular.ttf", fonts.reg);
  doc.addFileToVFS("Amiri-Bold.ttf", fonts.bold);
  doc.addFont("Amiri-Regular.ttf", "Amiri", "normal");
  doc.addFont("Amiri-Bold.ttf", "Amiri", "bold");
  return "Amiri";
}

export async function urlToDataUrl(url: string): Promise<{ data: string; format: "PNG" | "JPEG" } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.type !== "image/png" && blob.type !== "image/jpeg") return null;
    const data: string = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
    return { data, format: blob.type === "image/png" ? "PNG" : "JPEG" };
  } catch {
    return null;
  }
}
