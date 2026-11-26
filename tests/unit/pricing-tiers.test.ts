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

import { ladderOf, nextRungHint, pickRung, priceForQty, qtyUnitKey } from "@/lib/pricing";

describe("quantity ladder (per colisage)", () => {
  const tierPrices = [
    { tierId: "gros", price: 110 },
    { tierId: "super", price: 100 },
  ];
  // carton: 0 → base · 10 → gros · 50 → super ; pieces: 24 → gros
  const rungs = [
    { unitKey: "ctn", minQty: 50, tierId: "super" },
    { unitKey: "ctn", minQty: 0, tierId: null },
    { unitKey: "ctn", minQty: 10, tierId: "gros" },
    { unitKey: "", minQty: 24, tierId: "gros" },
  ];
  const base = { tierPrices, salePrice: 120, rungs, factor: 1 };

  it("unit key: base unit and no unit are both ''", () => {
    expect(qtyUnitKey(null, "pcs")).toBe("");
    expect(qtyUnitKey("pcs", "pcs")).toBe("");
    expect(qtyUnitKey("ctn", "pcs")).toBe("ctn");
  });
  it("sorts and de-dupes a ladder", () => {
    expect(ladderOf(rungs, "ctn").map((r) => r.minQty)).toEqual([0, 10, 50]);
    expect(ladderOf([...rungs, { unitKey: "ctn", minQty: 10, tierId: "super" }], "ctn")).toHaveLength(3);
    expect(ladderOf(null, "ctn")).toEqual([]);
  });
  it("picks the rung with the greatest minQty ≤ qty", () => {
    const at = (q: number) => priceForQty({ ...base, unitKey: "ctn", qty: q }).tierId;
    expect(at(1)).toBeNull();
    expect(at(9)).toBeNull();
    expect(at(10)).toBe("gros");
    expect(at(49.5)).toBe("gros");
    expect(at(50)).toBe("super");
    expect(at(500)).toBe("super");
  });
  it("prices one line unit = tier price × factor", () => {
    expect(priceForQty({ ...base, unitKey: "ctn", factor: 12, qty: 1 }).unitPrice).toBe(1440);
    expect(priceForQty({ ...base, unitKey: "ctn", factor: 12, qty: 10 }).unitPrice).toBe(1320);
    expect(priceForQty({ ...base, unitKey: "ctn", factor: 12, qty: 50 }).unitPrice).toBe(1200);
  });
  it("no ladder for the unit → normal tier fallback, never changes behaviour", () => {
    expect(priceForQty({ ...base, unitKey: "other", qty: 99, fallbackTierId: "gros" }).unitPrice).toBe(110);
    expect(priceForQty({ ...base, unitKey: "other", qty: 99 }).unitPrice).toBe(120);
    expect(pickRung([], "ctn", 5)).toBeNull();
  });
  it("qty below the first rung (ladder not starting at 0) falls back", () => {
    const r = [{ unitKey: "", minQty: 24, tierId: "gros" }];
    expect(priceForQty({ ...base, rungs: r, unitKey: "", qty: 5, fallbackTierId: "super" }).unitPrice).toBe(100);
    expect(priceForQty({ ...base, rungs: r, unitKey: "", qty: 24, fallbackTierId: "super" }).unitPrice).toBe(110);
  });
  it("a deleted tier / tier without a price keeps the base price (never 0)", () => {
    const r = [{ unitKey: "", minQty: 0, tierId: "ghost" }];
    expect(priceForQty({ ...base, rungs: r, unitKey: "", qty: 3 }).unitPrice).toBe(120);
  });
  it("garbage never leaks NaN", () => {
    expect(priceForQty({ ...base, unitKey: "ctn", qty: Number.NaN }).unitPrice).toBe(120);
    expect(priceForQty({ ...base, unitKey: "ctn", qty: 5, factor: 0 }).unitPrice).toBe(120);
  });
  it("hint: how many more to unlock the next, cheaper rung", () => {
    const h = nextRungHint({ ...base, unitKey: "ctn", qty: 7 })!;
    expect(h).toMatchObject({ missing: 3, atQty: 10, tierId: "gros", unitPrice: 110, saving: 10, pct: 8 });
    expect(nextRungHint({ ...base, unitKey: "ctn", qty: 12 })).toMatchObject({ missing: 38, atQty: 50, tierId: "super", pct: 9 });
    expect(nextRungHint({ ...base, unitKey: "ctn", qty: 60 })).toBeNull();
    expect(nextRungHint({ ...base, unitKey: "other", qty: 1 })).toBeNull();
  });
});
