import type { TicketLabels, TicketVM } from "@/components/sales/TicketView";
import { TICKET_HERO } from "@/lib/brand/ticketHero";
import { PRINT_WIDTH_DOTS, escposTicket, rgbaToMono } from "@/lib/escpos";
import { ticketNum, ticketShortDate } from "@/lib/ticket-format";

/// Draws the 80 mm facture onto a canvas (576 dots wide) for direct Bluetooth
/// printing. Mirrors the HTML ticket in print-ticket.ts (same blocks, same
/// order) but renders in canvas so it is pixel-exact on any phone, offline,
/// Arabic shaped by the browser. Decorative glyphs (◆ ★ ✦ ☎) are DRAWN as
/// shapes — phone fonts differ in which symbols they carry.

export type RasterCompany = {
  name: string;
  phone?: string | null;
  address?: string | null;
  rc?: string | null;
  nif?: string | null;
};

export type RasterArgs = {
  ticket: TicketVM;
  company: RasterCompany;
  labels: TicketLabels;
  lang: "ar" | "fr";
  qrDataUrl?: string | null;
};

type Rect = { x: number; y: number; w: number; h: number };

const W = PRINT_WIDTH_DOTS;
const PAD = 12;
const CW = W - PAD * 2;
const INK = "#000";
const PAPER = "#fff";

function loadImage(src: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // a broken logo must never block the ticket
    img.src = src;
  });
}

function fontFamily(): string {
  let fam = "";
  try {
    fam = getComputedStyle(document.body).fontFamily;
  } catch {
    /* ignore */
  }
  return `${fam ? `${fam}, ` : ""}"Noto Naskh Arabic", "Noto Sans Arabic", Tahoma, Arial, sans-serif`;
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

type TextOpts = { size: number; bold?: boolean; align?: "left" | "right" | "center"; color?: string; dir?: "ltr" | "rtl" };

/// One layout pass. draw=false only MEASURES (returns the height) so the
/// final canvas can be created at the exact size.
function layout(
  ctx: CanvasRenderingContext2D,
  draw: boolean,
  a: RasterArgs,
  hero: HTMLImageElement | null,
  qr: HTMLImageElement | null,
  dither: Rect[],
): number {
  const rtl = a.lang !== "fr";
  const fam = fontFamily();
  const t = a.ticket;
  const labels = a.labels;

  const setFont = (o: TextOpts) => {
    ctx.font = `${o.bold ? "700" : "400"} ${o.size}px ${fam}`;
    ctx.direction = o.dir ?? (rtl ? "rtl" : "ltr");
  };
  const measure = (s: string, o: TextOpts) => {
    setFont(o);
    return ctx.measureText(s).width;
  };
  /// Draws one line; `y` is the line TOP. Returns the line height.
  const text = (s: string, x: number, y: number, o: TextOpts): number => {
    const lh = Math.round(o.size * 1.35);
    if (draw && s) {
      setFont(o);
      ctx.textAlign = o.align ?? "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = o.color ?? INK;
      ctx.fillText(s, x, y + Math.round(o.size * 1.05));
    }
    return lh;
  };
  const wrap = (s: string, maxW: number, o: TextOpts): string[] => {
    const words = String(s ?? "").split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    const push = () => {
      if (cur) lines.push(cur);
      cur = "";
    };
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (measure(next, o) <= maxW) {
        cur = next;
        continue;
      }
      push();
      if (measure(w, o) <= maxW) {
        cur = w;
        continue;
      }
      // One word wider than the line: split by characters.
      let chunk = "";
      for (const ch of Array.from(w)) {
        if (measure(chunk + ch, o) > maxW && chunk) {
          lines.push(chunk);
          chunk = ch;
        } else chunk += ch;
      }
      cur = chunk;
    }
    push();
    return lines.length ? lines : [""];
  };
  /// Centered, wrapped paragraph.
  const para = (s: string, y: number, o: TextOpts): number => {
    let h = 0;
    for (const ln of wrap(s, CW, o)) h += text(ln, W / 2, y + h, { ...o, align: "center" });
    return h;
  };
  const diamond = (cx: number, cy: number, r: number) => {
    if (!draw) return;
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fill();
  };
  const star = (cx: number, cy: number, r: number, color = INK) => {
    if (!draw) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = (Math.PI / 5) * i - Math.PI / 2;
      const rad = i % 2 === 0 ? r : r * 0.45;
      const px = cx + Math.cos(ang) * rad;
      const py = cy + Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  };
  const hline = (y: number, x0 = PAD, x1 = W - PAD, lw = 2, dash: number[] = []) => {
    if (!draw) return;
    ctx.strokeStyle = INK;
    ctx.lineWidth = lw;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  const ornament = (y: number): number => {
    const cy = y + 12;
    hline(cy, PAD, W / 2 - 16, 3);
    hline(cy, W / 2 + 16, W - PAD, 3);
    diamond(W / 2, cy, 7);
    return 26;
  };
  /// label at the reading-start side, value at the other end.
  const pair = (label: string, value: string, y: number, o: TextOpts): number => {
    const lab = rtl ? { x: W - PAD, align: "right" as const } : { x: PAD, align: "left" as const };
    const val = rtl ? { x: PAD, align: "left" as const } : { x: W - PAD, align: "right" as const };
    const h = text(label, lab.x, y, { ...o, align: lab.align });
    text(value, val.x, y, { ...o, align: val.align, dir: "ltr" });
    return h;
  };

  let y = 8;

  // ── hero logo ──
  if (hero && hero.naturalWidth > 0) {
    const w = Math.round(CW * 0.8);
    const h = Math.min(330, Math.round((w * hero.naturalHeight) / hero.naturalWidth));
    const dw = Math.round((h * hero.naturalWidth) / hero.naturalHeight);
    const x = Math.round((W - dw) / 2);
    if (draw) {
      ctx.drawImage(hero, x, y, dw, h);
      dither.push({ x, y, w: dw, h });
    }
    y += h + 10;
  }

  // ── company ──
  const co = a.company;
  if (co.name && !/golden\s*wafer/i.test(co.name)) y += para(co.name, y, { size: 32, bold: true });
  if (co.address) y += para(co.address, y, { size: 21 });
  if (co.phone) y += para(co.phone, y, { size: 24, bold: true, dir: "ltr" });
  const fiscal = [co.rc ? `RC: ${co.rc}` : "", co.nif ? `NIF: ${co.nif}` : ""].filter(Boolean).join("  ·  ");
  if (fiscal) y += para(fiscal, y, { size: 20, dir: "ltr" });
  y += 4;
  y += ornament(y);

  // ── number + date (double rules) ──
  hline(y + 2, PAD, W - PAD, 2);
  hline(y + 7, PAD, W - PAD, 2);
  y += 12;
  const numTxt = `N° ${t.number ?? ""}`;
  const dateTxt = ticketShortDate(t.date);
  const rowH = text("", 0, 0, { size: 25 });
  {
    const startSide = rtl ? { x: W - PAD, align: "right" as const } : { x: PAD, align: "left" as const };
    const endSide = rtl ? { x: PAD, align: "left" as const } : { x: W - PAD, align: "right" as const };
    text(numTxt, startSide.x, y, { size: 25, bold: true, align: startSide.align, dir: "ltr" });
    text(dateTxt, endSide.x, y, { size: 25, bold: true, align: endSide.align, dir: "ltr" });
  }
  y += rowH + 4;
  hline(y + 2, PAD, W - PAD, 2);
  hline(y + 7, PAD, W - PAD, 2);
  y += 14;

  if (t.location?.name) y += para(t.location.name, y, { size: 22, bold: true }) + 4;

  // ── seller block (black) ──
  if (t.seller || t.sellerPhone) {
    const showName = !!t.seller && t.seller !== t.sellerPhone;
    const lab = String(labels.seller ?? "").toUpperCase();
    const padY = 10;
    const h = padY * 2 + (lab ? 22 : 0) + (showName ? 32 : 0) + (t.sellerPhone ? 50 : 0);
    if (draw) {
      ctx.fillStyle = INK;
      rr(ctx, PAD, y, CW, h, 12);
      ctx.fill();
    }
    let by = y + padY;
    if (lab) by += text(lab, W / 2, by, { size: 16, bold: true, align: "center", color: PAPER });
    if (showName) by += text(String(t.seller), W / 2, by, { size: 25, bold: true, align: "center", color: PAPER });
    if (t.sellerPhone) text(String(t.sellerPhone), W / 2, by, { size: 40, bold: true, align: "center", color: PAPER, dir: "ltr" });
    y += h + 10;
  }

  // ── client box ──
  if (t.client) {
    const nameO: TextOpts = { size: 27, bold: true };
    const nameLines = wrap(String(t.client.name ?? ""), CW - 24, nameO);
    const sub = `${t.client.code ?? ""}${t.client.phone ? `  ·  ${t.client.phone}` : ""}`;
    const h = 10 + nameLines.length * Math.round(27 * 1.35) + (sub ? 28 : 0) + 8;
    if (draw) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      rr(ctx, PAD + 1.5, y + 1.5, CW - 3, h - 3, 12);
      ctx.stroke();
    }
    let cy = y + 10;
    for (const ln of nameLines) cy += text(ln, W / 2, cy, { ...nameO, align: "center" });
    if (sub) text(sub, W / 2, cy, { size: 21, align: "center", dir: "ltr" });
    y += h + 10;
  }
  y += ornament(y);

  // ── lines table ──
  const qtyW = 64;
  const unitW = 98;
  const totW = 114;
  const gap = 6;
  const nameW = CW - qtyW - unitW - totW - gap * 3;
  // Cell [x0,x1] ranges, visual left→right.
  const cells = rtl
    ? (() => {
        const nameR = { x0: W - PAD - nameW, x1: W - PAD };
        const qtyR = { x0: nameR.x0 - gap - qtyW, x1: nameR.x0 - gap };
        const unitR = { x0: qtyR.x0 - gap - unitW, x1: qtyR.x0 - gap };
        const totR = { x0: unitR.x0 - gap - totW, x1: unitR.x0 - gap };
        return { nameR, qtyR, unitR, totR };
      })()
    : (() => {
        const nameR = { x0: PAD, x1: PAD + nameW };
        const qtyR = { x0: nameR.x1 + gap, x1: nameR.x1 + gap + qtyW };
        const unitR = { x0: qtyR.x1 + gap, x1: qtyR.x1 + gap + unitW };
        const totR = { x0: unitR.x1 + gap, x1: unitR.x1 + gap + totW };
        return { nameR, qtyR, unitR, totR };
      })();
  const nameO: TextOpts = { size: 23, bold: true };
  const numO: TextOpts = { size: 23, dir: "ltr" };
  const freeTxt = a.lang === "fr" ? "Gratuit" : "مجاني";
  for (const l of t.lines ?? []) {
    const lines = wrap(String(l.name ?? ""), nameW, nameO);
    const lh = Math.round(23 * 1.35);
    let ny = y;
    for (const ln of lines) {
      ny += text(ln, rtl ? cells.nameR.x1 : cells.nameR.x0, ny, { ...nameO, align: rtl ? "right" : "left" });
    }
    if (l.bonus) {
      const sy = ny + 2;
      const fh = Math.round(20 * 1.35);
      const startX = rtl ? cells.nameR.x1 : cells.nameR.x0;
      const fw = measure(freeTxt, { size: 20, bold: true });
      const starCx = rtl ? startX - 9 : startX + 9;
      star(starCx, sy + fh / 2, 8);
      text(freeTxt, rtl ? startX - 22 : startX + 22, sy, { size: 20, bold: true, align: rtl ? "right" : "left" });
      void fw;
      ny += fh + 2;
    }
    text(ticketNum(l.qty), cells.qtyR.x1, y, { ...numO, align: "right" });
    text(ticketNum(l.unitPrice), cells.unitR.x1, y, { ...numO, align: "right" });
    text(ticketNum(l.lineTotal), cells.totR.x1, y, { ...numO, bold: true, align: "right" });
    y = Math.max(ny, y + lh) + 7;
  }
  hline(y + 2, PAD, W - PAD, 2, [7, 6]);
  y += 12;

  // ── totals ──
  const total = Number(t.total ?? 0);
  const paid = Number(t.paid ?? 0);
  const due = Math.round((total - paid) * 100) / 100;
  if (Number(t.remise ?? 0) > 0) {
    y += pair(labels.remise ?? "Remise", `- ${ticketNum(t.remise)}`, y, { size: 22 }) + 4;
  }
  {
    const h = 52;
    if (draw) {
      ctx.fillStyle = INK;
      rr(ctx, PAD, y, CW, h, 12);
      ctx.fill();
    }
    const ty = y + 9;
    const lab = rtl ? { x: W - PAD - 14, align: "right" as const } : { x: PAD + 14, align: "left" as const };
    const val = rtl ? { x: PAD + 14, align: "left" as const } : { x: W - PAD - 14, align: "right" as const };
    text(labels.total ?? "Total", lab.x, ty, { size: 33, bold: true, align: lab.align, color: PAPER });
    text(ticketNum(t.total), val.x, ty, { size: 33, bold: true, align: val.align, color: PAPER, dir: "ltr" });
    y += h + 6;
  }
  y += pair(labels.paid ?? "Paid", ticketNum(t.paid), y, { size: 25 }) + 4;
  {
    const h = 46;
    if (draw) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      rr(ctx, PAD + 1.5, y + 1.5, CW - 3, h - 3, 12);
      ctx.stroke();
    }
    const ty = y + 8;
    const lab = rtl ? { x: W - PAD - 14, align: "right" as const } : { x: PAD + 14, align: "left" as const };
    const val = rtl ? { x: PAD + 14, align: "left" as const } : { x: W - PAD - 14, align: "right" as const };
    text(labels.due ?? "Due", lab.x, ty, { size: 29, bold: true, align: lab.align });
    text(ticketNum(due), val.x, ty, { size: 29, bold: true, align: val.align, dir: "ltr" });
    y += h + 10;
  }
  y += ornament(y);

  // ── QR (integer module scale when possible → crisp, scannable) ──
  if (qr && qr.naturalWidth > 0) {
    const n = qr.naturalWidth;
    const target = 264;
    const k = n <= target ? Math.floor(target / n) : 0;
    const size = k >= 1 ? n * k : target;
    const x = Math.round((W - size) / 2);
    if (draw) {
      ctx.imageSmoothingEnabled = k < 1;
      ctx.drawImage(qr, x, y, size, size);
      ctx.imageSmoothingEnabled = true;
    }
    y += size + 10;
  }

  // ── thanks ──
  if (labels.thanks) {
    const o: TextOpts = { size: 27, bold: true };
    const lines = wrap(labels.thanks, CW - 70, o);
    const widest = Math.max(...lines.map((s) => measure(s, o)));
    const cy = y + (lines.length * Math.round(27 * 1.35)) / 2;
    star(W / 2 - widest / 2 - 22, cy, 11);
    star(W / 2 + widest / 2 + 22, cy, 11);
    for (const ln of lines) y += text(ln, W / 2, y, { ...o, align: "center" });
    y += 4;
  }
  if (t.sellerPhone) y += text(String(t.sellerPhone), W / 2, y, { size: 24, bold: true, align: "center", dir: "ltr" });

  return y + 16;
}

export async function renderTicketCanvas(a: RasterArgs): Promise<{ canvas: HTMLCanvasElement; dither: Rect[] }> {
  try {
    await document.fonts?.ready;
  } catch {
    /* ignore */
  }
  const [hero, qr] = await Promise.all([loadImage(TICKET_HERO), loadImage(a.qrDataUrl)]);
  const probe = document.createElement("canvas");
  probe.width = W;
  probe.height = 8;
  const pctx = probe.getContext("2d");
  if (!pctx) throw new Error("no_canvas");
  const height = Math.max(120, Math.ceil(layout(pctx, false, a, hero, qr, [])));
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no_canvas");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, height);
  ctx.imageSmoothingEnabled = true;
  const dither: Rect[] = [];
  layout(ctx, true, a, hero, qr, dither);
  return { canvas, dither };
}

/// Ticket → complete ESC/POS byte stream, ready to write to the printer.
export async function ticketToEscPos(a: RasterArgs, opts: { cut?: boolean } = {}): Promise<Uint8Array> {
  const { canvas, dither } = await renderTicketCanvas(a);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no_canvas");
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const mono = rgbaToMono(img.data, canvas.width, canvas.height, { dither });
  return escposTicket(mono, { cut: opts.cut !== false });
}
