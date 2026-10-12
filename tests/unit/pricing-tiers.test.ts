import { describe, expect, it } from "vitest";
import { mergeTiers, resolveTierPrice } from "@/lib/pricing";

describe("resolveTierPrice (van tier toggle)", () => {
  const tiers = [
    { tierId: "gros", price: 130 },
    { tierId: "super", price: 120 },
  ];
  it("null/unknown tier → base sale price", () => {
    expect(resolveTierPrice(tiers, 150, null)).toBe(150);
    expect(resolveTierPrice(tiers, 150, undefined)).toBe(150);
    expect(resolveTierPrice(tiers, 150, "nope")).toBe(150);
    expect(resolveTierPrice(null, 150, "gros")).toBe(150);
  });
  it("known tier with a price → tier price", () => {
    expect(resolveTierPrice(tiers, 150, "gros")).toBe(130);
    expect(resolveTierPrice(tiers, 150, "super")).toBe(120);
  });
  it("product without that tier price keeps its single price", () => {
    expect(resolveTierPrice([], 150, "gros")).toBe(150);
    expect(resolveTierPrice([{ tierId: "super", price: 120 }], 150, "gros")).toBe(150);
  });
  it("garbage never leaks NaN", () => {
    expect(resolveTierPrice(tiers, "abc", "gros")).toBe(130);
    expect(resolveTierPrice([], "abc", "gros")).toBe(0);
  });
});

describe("mergeTiers", () => {
  it("unions by id, snapshot wins, tolerates garbage", () => {
    expect(
      mergeTiers(
        [{ id: "a", name: "Old" }, { id: "b", name: "B" }],
        [{ id: "a", name: "New" }, null as never],
      ),
    ).toEqual([
      { id: "a", name: "New" },
      { id: "b", name: "B" },
    ]);
    expect(mergeTiers(null, undefined)).toEqual([]);
  });
});
