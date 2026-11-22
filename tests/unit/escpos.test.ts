import { describe, expect, it } from "vitest";
import { CUT_MODES, PRINT_WIDTH_DOTS, bytesToBase64, cutBytes, escposCutTest, escposTicket, rgbaToMono } from "@/lib/escpos";

function rgba(w: number, h: number, fn: (x: number, y: number) => number) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = fn(x, y);
      const p = (y * w + x) * 4;
      d[p] = d[p + 1] = d[p + 2] = v;
      d[p + 3] = 255;
    }
  return d;
}

describe("rgbaToMono", () => {
  it("packs MSB-first, 1 = black", () => {
    // 8 px wide: black, white × 3 pattern → 10101010
    const m = rgbaToMono(rgba(8, 1, (x) => (x % 2 === 0 ? 0 : 255)), 8, 1);
    expect(m.bytes[0]).toBe(0b10101010);
  });
  it("rejects widths that are not a multiple of 8", () => {
    expect(() => rgbaToMono(rgba(10, 1, () => 0), 10, 1)).toThrow();
  });
  it("treats transparent pixels as paper", () => {
    const d = new Uint8ClampedArray(8 * 4); // all zero alpha
    expect(rgbaToMono(d, 8, 1).bytes[0]).toBe(0);
  });
  it("dithers a mid-grey region but hard-thresholds the rest", () => {
    const w = 16;
    const grey = rgba(w, 8, () => 128);
    const hard = rgbaToMono(grey, w, 8, { threshold: 170 });
    expect(hard.bytes.every((b) => b === 0xff)).toBe(true); // 128 < 170 → all black
    const dith = rgbaToMono(grey, w, 8, { dither: [{ x: 0, y: 0, w, h: 8 }] });
    const ones = [...dith.bytes].reduce((n, b) => n + b.toString(2).replace(/0/g, "").length, 0);
    expect(ones).toBeGreaterThan(w * 8 * 0.3);
    expect(ones).toBeLessThan(w * 8 * 0.7);
  });
});

describe("escposTicket", () => {
  const bmp = rgbaToMono(rgba(PRINT_WIDTH_DOTS, 200, () => 0), PRINT_WIDTH_DOTS, 200);
  it("starts with init + left-align", () => {
    const b = escposTicket(bmp);
    expect([...b.slice(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x61, 0x00]);
  });
  it("default (auto) ends with feed + GS V 66 0", () => {
    const b = escposTicket(bmp);
    expect([...b.slice(-7)]).toEqual([0x1b, 0x64, 3, 0x1d, 0x56, 0x42, 0x00]);
  });
  it("splits into GS v 0 bands that cover every row exactly once", () => {
    const b = escposTicket(bmp, { cutMode: "none" });
    const tail = cutBytes("none").length;
    let rows = 0;
    let i = 5; // after ESC @ ESC a 0
    while (i < b.length - tail) {
      expect([b[i], b[i + 1], b[i + 2], b[i + 3]]).toEqual([0x1d, 0x76, 0x30, 0x00]);
      const wb = b[i + 4] | (b[i + 5] << 8);
      const h = b[i + 6] | (b[i + 7] << 8);
      expect(wb).toBe(72);
      rows += h;
      i += 8 + wb * h;
    }
    expect(rows).toBe(200);
    expect(i).toBe(b.length - tail);
  });
});

describe("cut modes", () => {
  it("each mode emits its own documented command", () => {
    expect(cutBytes("auto")).toEqual([0x1b, 0x64, 3, 0x1d, 0x56, 0x42, 0x00]); // GS V 66 0
    expect(cutBytes("full")).toEqual([0x1b, 0x64, 7, 0x1d, 0x56, 0x00]); // GS V 0
    expect(cutBytes("partial")).toEqual([0x1b, 0x64, 7, 0x1d, 0x56, 0x01]); // GS V 1
    expect(cutBytes("legacy")).toEqual([0x1b, 0x64, 7, 0x1b, 0x69]); // ESC i
  });
  it("none sends only a feed, never a cut opcode", () => {
    const b = cutBytes("none");
    expect(b).toEqual([0x1b, 0x64, 4]);
    expect(b.includes(0x56)).toBe(false);
  });
  it("every listed mode is handled", () => {
    for (const m of CUT_MODES) expect(cutBytes(m).length).toBeGreaterThan(0);
  });
  it("the test job is init + the mode's cut, with no image", () => {
    const j = escposCutTest("full");
    expect([...j]).toEqual([0x1b, 0x40, 0x1b, 0x64, 7, 0x1d, 0x56, 0x00]);
  });
  it("a ticket job ends with exactly the chosen cut", () => {
    const bmp = rgbaToMono(rgba(PRINT_WIDTH_DOTS, 8, () => 255), PRINT_WIDTH_DOTS, 8);
    for (const m of CUT_MODES) {
      const b = escposTicket(bmp, { cutMode: m });
      const tail = cutBytes(m);
      expect([...b.slice(b.length - tail.length)]).toEqual(tail);
    }
  });
});

describe("bytesToBase64", () => {
  it("round-trips a large buffer without overflowing the stack", () => {
    const big = new Uint8Array(200_000).map((_, i) => i % 251);
    const back = Uint8Array.from(atob(bytesToBase64(big)), (c) => c.charCodeAt(0));
    expect(back.length).toBe(big.length);
    expect(back[199_999]).toBe(big[199_999]);
  });
});

import { btErr } from "@/lib/bt-printer";

describe("btErr (native error → code)", () => {
  it("extracts the bare native code from the message", () => {
    expect(btErr(new Error("connect_failed"))).toBe("connect_failed");
    expect(btErr({ message: "Error: pair_timeout" })).toBe("pair_timeout");
    expect(btErr("cancelled")).toBe("cancelled");
  });
  it("maps a missing plugin (old APK) and unknown errors", () => {
    expect(btErr(new Error('"BtPrinter" plugin is not implemented on android'))).toBe("no_plugin");
    expect(btErr(new Error("boom"))).toBe("unknown");
    expect(btErr(null)).toBe("unknown");
  });
});
