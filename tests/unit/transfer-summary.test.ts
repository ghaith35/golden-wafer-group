import { describe, it, expect } from "vitest";
import { packFactor, lineQty, lineColis, summarize } from "@/lib/transfers/summary";

const carton12 = { conversions: [{ unitId: "ctn", factor: 12 }] };
const twoPacks = { conversions: [{ unitId: "box", factor: 6 }, { unitId: "ctn", factor: 24 }] };
const noPack = { conversions: [] };

describe("van request summary", () => {
  it("pack factor is the smallest pack, 0 when there is none", () => {
    expect(packFactor(carton12)).toBe(12);
    expect(packFactor(twoPacks)).toBe(6);
    expect(packFactor(noPack)).toBe(0);
    expect(packFactor(null)).toBe(0);
  });
  it("uses the confirmed quantity when there is one, else the declared one", () => {
    expect(lineQty({ declaredQty: "60", confirmedQty: null })).toBe(60);
    expect(lineQty({ declaredQty: 60, confirmedQty: "48" })).toBe(48);
  });
  it("converts a line to colis, null without a pack", () => {
    expect(lineColis({ declaredQty: 60, confirmedQty: null, product: carton12 })).toBe(5);
    expect(lineColis({ declaredQty: 18, confirmedQty: null, product: carton12 })).toBe(1.5);
    expect(lineColis({ declaredQty: 18, confirmedQty: null, product: noPack })).toBeNull();
  });
  it("totals products, colis and pieces", () => {
    const s = summarize([
      { declaredQty: 60, confirmedQty: null, product: carton12 }, // 5 colis
      { declaredQty: 36, confirmedQty: 24, product: carton12 }, // 2 colis (confirmed)
      { declaredQty: 10, confirmedQty: null, product: noPack }, // 10 pieces, no colis
    ]);
    expect(s).toEqual({ products: 3, colis: 7, pieces: 94 });
  });
});
