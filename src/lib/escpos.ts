/// ESC/POS encoding for 80 mm thermal printers (Xprinter and clones).
/// The ticket is printed as ONE raster image (GS v 0): Arabic shaping, logo,
/// QR and bars come out exactly as rendered — no codepage / font problems.
/// Pure functions (no DOM) so they are unit-tested.

/// 80 mm paper, 203 dpi → 576 printable dots (72 mm) = 72 bytes per row.
export const PRINT_WIDTH_DOTS = 576;

/// Rows per GS v 0 command. Cheap printers have small input buffers; short
/// bands keep every command well inside them.
const BAND_ROWS = 96;

export type MonoBitmap = {
  width: number; // dots, multiple of 8
  height: number; // rows
  /// Packed 1 bit/pixel, MSB first, 1 = black. Length = (width/8) * height.
  bytes: Uint8Array;
};

/// RGBA canvas pixels → packed 1-bit bitmap. `dither` rects (hero logo) use
/// Floyd–Steinberg for photographic tones; everything else (text, bars, QR)
/// is a hard threshold so edges stay crisp. Threshold is on the generous
/// side: thermal printing thins strokes, so mid-greys go black.
export function rgbaToMono(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  opts: { threshold?: number; dither?: Array<{ x: number; y: number; w: number; h: number }> } = {},
): MonoBitmap {
  if (width % 8 !== 0) throw new Error("width must be a multiple of 8");
  const threshold = opts.threshold ?? 170;
  const lum = new Float32Array(width * height);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    // Transparent pixels count as paper (white).
    const a = rgba[p + 3] / 255;
    const l = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    lum[i] = l * a + 255 * (1 - a);
  }
  for (const r of opts.dither ?? []) {
    const x0 = Math.max(0, Math.floor(r.x));
    const y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(width, Math.ceil(r.x + r.w));
    const y1 = Math.min(height, Math.ceil(r.y + r.h));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * width + x;
        const old = lum[i];
        const nw = old < 128 ? 0 : 255;
        lum[i] = nw;
        const err = old - nw;
        if (x + 1 < x1) lum[i + 1] += (err * 7) / 16;
        if (y + 1 < y1) {
          if (x > x0) lum[i + width - 1] += (err * 3) / 16;
          lum[i + width] += (err * 5) / 16;
          if (x + 1 < x1) lum[i + width + 1] += err / 16;
        }
      }
    }
  }
  const wb = width / 8;
  const bytes = new Uint8Array(wb * height);
  for (let y = 0; y < height; y++) {
    for (let bx = 0; bx < wb; bx++) {
      let b = 0;
      for (let k = 0; k < 8; k++) {
        b <<= 1;
        if (lum[y * width + bx * 8 + k] < threshold) b |= 1;
      }
      bytes[y * wb + bx] = b;
    }
  }
  return { width, height, bytes };
}

/// Paper-cut strategies. Printers differ, so the driver can pick (and test)
/// the one that works on his model:
///  auto    GS V 66 0  — "feed to cutter + partial cut" (Epson function B;
///          Xprinter XP-80 / N160 family). Feeds by itself → short extra feed.
///  full    GS V 0     — full cut, needs the paper fed past the blade first.
///  partial GS V 1     — partial cut (leaves a tiny hinge), same feed need.
///  legacy  ESC i      — old Epson/clone cutters.
///  none    tear-bar printers: nothing sent.
export type CutMode = "auto" | "full" | "partial" | "legacy" | "none";
export const CUT_MODES: CutMode[] = ["auto", "full", "partial", "legacy", "none"];

/// Feed + cut commands for a mode. Non-auto modes feed ~26 mm first so the
/// last printed line has passed the blade before it closes.
export function cutBytes(mode: CutMode): number[] {
  switch (mode) {
    case "auto":
      return [0x1b, 0x64, 0x03, 0x1d, 0x56, 0x42, 0x00]; // ESC d 3 · GS V B 0
    case "full":
      return [0x1b, 0x64, 0x07, 0x1d, 0x56, 0x00]; // ESC d 7 · GS V 0
    case "partial":
      return [0x1b, 0x64, 0x07, 0x1d, 0x56, 0x01]; // ESC d 7 · GS V 1
    case "legacy":
      return [0x1b, 0x64, 0x07, 0x1b, 0x69]; // ESC d 7 · ESC i
    case "none":
      return [0x1b, 0x64, 0x04]; // just feed enough to tear
  }
}

/// A tiny job (no ticket) that only feeds + cuts — the "Test cut" button.
export function escposCutTest(mode: CutMode): Uint8Array {
  return Uint8Array.from([0x1b, 0x40, ...cutBytes(mode)]);
}

/// Full print job: init → raster bands → feed + cut (per mode).
export function escposTicket(bmp: MonoBitmap, opts: { cutMode?: CutMode } = {}): Uint8Array {
  const wb = bmp.width / 8;
  if (wb > 0xffff) throw new Error("bitmap too wide");
  const parts: Uint8Array[] = [];
  parts.push(Uint8Array.from([0x1b, 0x40])); // ESC @  initialize
  parts.push(Uint8Array.from([0x1b, 0x61, 0x00])); // ESC a 0  left align
  for (let y = 0; y < bmp.height; y += BAND_ROWS) {
    const rows = Math.min(BAND_ROWS, bmp.height - y);
    // GS v 0 m xL xH yL yH d1…dk   (m = 0 normal density)
    parts.push(Uint8Array.from([0x1d, 0x76, 0x30, 0x00, wb & 0xff, (wb >> 8) & 0xff, rows & 0xff, (rows >> 8) & 0xff]));
    parts.push(bmp.bytes.subarray(y * wb, (y + rows) * wb));
  }
  parts.push(Uint8Array.from(cutBytes(opts.cutMode ?? "auto")));
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/// Base64 for the Capacitor bridge (chunked: a single apply() would overflow
/// the call stack on a ~100 KB job).
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}
