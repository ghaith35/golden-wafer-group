import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { TicketView, type TicketCompanyVM, type TicketLabels, type TicketVM } from "@/components/sales/TicketView";
import { PRINT_WIDTH_DOTS, escposTicket, rgbaToMono, type CutMode } from "@/lib/escpos";

/// Direct Bluetooth print = EXACTLY the ticket the driver sees. We render the
/// real <TicketView> (the same component as the on-screen viewer and the
/// print page) off-screen at 80 mm, rasterise it, and send it as ESC/POS.
/// There is no second ticket design to keep in sync.
///
/// Geometry: 80 mm paper @ 203 dpi = 640 dots. TicketView already pads 4 mm
/// (= 32 dots) each side, so the 72 mm the head can print (576 dots) is the
/// middle of the capture — we crop those 32 dots away on both sides.

const PAPER_DOTS = 640;

export type CaptureArgs = {
  ticket: TicketVM;
  company: TicketCompanyVM;
  labels: TicketLabels;
  lang: "ar" | "fr";
  qrDataUrl?: string | null;
};

type Rect = { x: number; y: number; w: number; h: number };

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

async function imagesReady(root: HTMLElement) {
  const imgs = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    imgs.map((img) =>
      img.complete && img.naturalWidth > 0
        ? Promise.resolve()
        : img.decode
          ? img.decode().catch(() => undefined)
          : new Promise<void>((r) => {
              img.onload = img.onerror = () => r();
            }),
    ),
  );
}

/// Renders the ticket and returns it as a 576-dot-wide canvas plus the hero
/// logo rectangle (photographic → dithered) with the QR redrawn crisp.
export async function captureTicketCanvas(a: CaptureArgs): Promise<{ canvas: HTMLCanvasElement; dither: Rect[] }> {
  // The app's interface zoom is CSS `zoom` on <html>. html2canvas reads real
  // layout rects but un-zoomed computed font sizes, so under zoom the text
  // would not match the boxes. Cancel the zoom for this subtree: the
  // effective zoom is 1 and every measure agrees.
  let z = 1;
  try {
    z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  } catch {
    /* ignore */
  }
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  // Behind everything (the printer screen is opaque and above) but inside the
  // viewport — html2canvas renders it faithfully there.
  host.style.cssText = `position:fixed;left:0;top:0;z-index:-1;pointer-events:none;background:#fff;width:max-content;zoom:${1 / z}`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() =>
      root.render(
        createElement(TicketView, {
          ticket: a.ticket,
          company: a.company,
          width: "80",
          locale: a.lang,
          labels: a.labels,
          qrDataUrl: a.qrDataUrl ?? null,
          lang: a.lang,
        }),
      ),
    );
    try {
      await document.fonts?.ready;
    } catch {
      /* ignore */
    }
    await imagesReady(host);
    await nextFrame();
    await nextFrame();

    const el = host.querySelector<HTMLElement>(".ticket");
    if (!el) throw new Error("ticket_not_rendered");
    const rect = el.getBoundingClientRect();
    if (rect.width < 10) throw new Error("ticket_not_rendered");
    const html2canvas = (await import("html2canvas-pro")).default;
    const full = await html2canvas(el, {
      scale: PAPER_DOTS / rect.width,
      backgroundColor: "#ffffff",
      logging: false,
      useCORS: false,
      imageTimeout: 0,
      // Letter-spacing makes html2canvas draw text char-by-char, which breaks
      // Arabic joining/direction (the tracked "البائع" label came out garbled).
      // Arabic text prints with normal spacing; Latin keeps the tracking.
      onclone: (doc) => {
        const arabic = /[\u0600-\u06FF]/;
        doc.querySelectorAll<HTMLElement>(".ticket *").forEach((n) => {
          for (const c of Array.from(n.childNodes)) {
            if (c.nodeType === 3 && arabic.test(c.nodeValue ?? "")) {
              n.style.letterSpacing = "normal";
              break;
            }
          }
        });
      },
    });

    const sx = Math.max(0, Math.round((full.width - PRINT_WIDTH_DOTS) / 2));
    const canvas = document.createElement("canvas");
    canvas.width = PRINT_WIDTH_DOTS;
    canvas.height = full.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no_canvas");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(full, sx, 0, PRINT_WIDTH_DOTS, full.height, 0, 0, PRINT_WIDTH_DOTS, full.height);

    // Element rect → output canvas coordinates.
    const k = full.width / rect.width;
    const rel = (r: DOMRect): Rect => ({ x: (r.left - rect.left) * k - sx, y: (r.top - rect.top) * k, w: r.width * k, h: r.height * k });
    const dither: Rect[] = [];
    const imgs = Array.from(el.querySelectorAll("img"));
    const qrSrc = a.qrDataUrl ?? "";
    for (const img of imgs) {
      const isQr = !!qrSrc && img.src === qrSrc;
      const r = rel(img.getBoundingClientRect());
      if (!isQr) {
        dither.push(r); // hero logo: photographic tones
        continue;
      }
      // QR: redraw at an integer module scale with no smoothing so modules
      // stay razor-sharp and scannable.
      const n = img.naturalWidth;
      if (n > 0 && n <= r.w) {
        const size = n * Math.max(1, Math.floor(r.w / n));
        const x = Math.round(r.x + (r.w - size) / 2);
        const y = Math.round(r.y + (r.h - size) / 2);
        ctx.fillStyle = "#fff";
        // Clear a few dots past the image: html2canvas anti-aliasing leaves a faint
        // fringe just outside it (visible under fractional zoom).
        ctx.fillRect(Math.floor(r.x) - 4, Math.floor(r.y) - 4, Math.ceil(r.w) + 9, Math.ceil(r.h) + 9);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, x, y, size, size);
        ctx.imageSmoothingEnabled = true;
      }
    }
    return { canvas, dither };
  } finally {
    try {
      root.unmount();
    } catch {
      /* ignore */
    }
    host.remove();
  }
}

/// Ticket → complete ESC/POS byte stream (image + feed + cut), ready to send.
export async function ticketToEscPos(a: CaptureArgs, opts: { cutMode?: CutMode } = {}): Promise<Uint8Array> {
  const { canvas, dither } = await captureTicketCanvas(a);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no_canvas");
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const mono = rgbaToMono(img.data, canvas.width, canvas.height, { dither });
  return escposTicket(mono, { cutMode: opts.cutMode });
}
