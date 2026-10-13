import { describe, expect, it } from "vitest";
import { computeSaleDistM } from "@/lib/sales/site-check";
import { haversineM } from "@/lib/geo-math";

// Silent sale-site check: real distance when both sides exist, null for
// anything missing/invalid — never a zero that reads as "at the client".
describe("computeSaleDistM", () => {
  // Algiers centre → ~1.1km north.
  it("returns rounded meters for two valid fixes", () => {
    const m = computeSaleDistM(36.7538, 3.0588, 36.7638, 3.0588, haversineM);
    expect(m).toBeGreaterThan(900);
    expect(m).toBeLessThan(1300);
  });

  it("same point → 0 (a true zero, not a missing value)", () => {
    expect(computeSaleDistM(36.75, 3.05, 36.75, 3.05, haversineM)).toBe(0);
  });

  it("null when the fix or the client position is missing", () => {
    expect(computeSaleDistM(null, 3.05, 36.75, 3.05, haversineM)).toBeNull();
    expect(computeSaleDistM(36.75, 3.05, null, null, haversineM)).toBeNull();
    expect(computeSaleDistM(undefined, undefined, 36.75, 3.05, haversineM)).toBeNull();
  });

  it("null on garbage and out-of-range coords", () => {
    expect(computeSaleDistM("abc", 3.05, 36.75, 3.05, haversineM)).toBeNull();
    expect(computeSaleDistM(120, 3.05, 36.75, 3.05, haversineM)).toBeNull();
    expect(computeSaleDistM(36.75, 400, 36.75, 3.05, haversineM)).toBeNull();
  });
});
