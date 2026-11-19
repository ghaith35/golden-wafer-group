import { describe, it, expect } from "vitest";
import { computeDTotals } from "@/lib/dinvoice";

describe("computeDTotals", () => {
  it("applies remise, tva and timbre on net HT", () => {
    const t = computeDTotals([1000, 500], { remisePercent: 10, timbrePercent: 1, tvaPercent: 19 });
    expect(t.gross).toBe(1500);
    expect(t.remise).toBe(150);
    expect(t.netHt).toBe(1350);
    expect(t.tva).toBe(256.5);
    expect(t.timbre).toBe(13.5);
    expect(t.ttc).toBe(1620);
    expect(t.lines[0].tva).toBe(171);
  });
  it("clamps bad input", () => {
    const t = computeDTotals([100], { remisePercent: 500, timbrePercent: NaN, tvaPercent: 0 });
    expect(t.netHt).toBe(0);
    expect(t.ttc).toBe(0);
  });
});
