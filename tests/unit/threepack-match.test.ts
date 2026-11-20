import { describe, expect, it } from "vitest";
import {
  colisOf,
  computeBonus,
  overClaimedBonus,
  ruleShapeError,
  type ColisInfo,
  type ThreePackRuleLite,
} from "@/lib/threepack/match";

// Products: A, B, C sold by carton of 12 (base = bottle); L = legacy product
// whose BASE unit is the carton itself (pieces are 1/N conversions).
const COLIS: Record<string, ColisInfo> = {
  A: { unitId: "u-cartonA", factor: 12 },
  B: { unitId: "u-cartonB", factor: 12 },
  C: { unitId: "u-cartonC", factor: 6 },
  L: { unitId: "u-base", factor: 1 },
};
// helper: purchase of `n` colis of a product → base qty
const buy = (productId: string, nColis: number) => ({ productId, baseQty: nColis * COLIS[productId].factor });

const single: ThreePackRuleLite = {
  id: "r-single", name: "10 → 1", mode: "SINGLE", isActive: true,
  items: [{ role: "BUY", productId: "A", colis: 10 }, { role: "GIVE", productId: "A", colis: 1 }],
};
const pack: ThreePackRuleLite = {
  id: "r-pack", name: "Pack ABC", mode: "PACK", isActive: true,
  items: [
    { role: "BUY", productId: "A", colis: 10 },
    { role: "BUY", productId: "B", colis: 10 },
    { role: "BUY", productId: "C", colis: 10 },
    { role: "GIVE", productId: "A", colis: 1 },
    { role: "GIVE", productId: "B", colis: 2 },
  ],
};

describe("3pack — computeBonus", () => {
  it("single rule: the free product can be a DIFFERENT product (buy 10 of A → 1 of B)", () => {
    const r: ThreePackRuleLite = {
      id: "r-ab", name: "A→B", mode: "SINGLE", isActive: true,
      items: [{ role: "BUY", productId: "A", colis: 10 }, { role: "GIVE", productId: "B", colis: 1 }],
    };
    const g = computeBonus([r], [buy("A", 25)], COLIS);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ productId: "B", unitId: "u-cartonB", colis: 2, baseQty: 24 });
  });

  it("a pack can be any size (5 products) with any quantities, even fractions", () => {
    const r: ThreePackRuleLite = {
      id: "r-5", name: "five", mode: "PACK", isActive: true,
      items: [
        { role: "BUY", productId: "A", colis: 1 }, { role: "BUY", productId: "B", colis: 2 }, { role: "BUY", productId: "C", colis: 3 },
        { role: "BUY", productId: "L", colis: 0.5 }, { role: "BUY", productId: "C2", colis: 1 },
        { role: "GIVE", productId: "A", colis: 0.5 },
      ],
    };
    const colis = { ...COLIS, C2: { unitId: "u-c2", factor: 6 } };
    const lines = [buy("A", 2), buy("B", 4), buy("C", 6), { productId: "L", baseQty: 1 }, { productId: "C2", baseQty: 12 }];
    expect(computeBonus([r], lines, colis)[0].colis).toBe(1); // bought the pack twice → 2 × 0.5
  });

  it("single rule: below threshold → nothing", () => {
    expect(computeBonus([single], [buy("A", 9)], COLIS)).toEqual([]);
  });

  it("single rule: exactly the threshold → 1 free colis in the colis unit", () => {
    const g = computeBonus([single], [buy("A", 10)], COLIS);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ ruleId: "r-single", productId: "A", unitId: "u-cartonA", colis: 1, baseQty: 12 });
  });

  it("every multiple counts: 25 colis on a 10→1 rule gives 2", () => {
    expect(computeBonus([single], [buy("A", 25)], COLIS)[0].colis).toBe(2);
    expect(computeBonus([single], [buy("A", 30)], COLIS)[0].colis).toBe(3);
  });

  it("sums several lines of the same product (and mixes units via baseQty)", () => {
    // 6 colis + 72 loose bottles (= 6 colis) = 12 colis → 1 free
    const g = computeBonus([single], [buy("A", 6), { productId: "A", baseQty: 72 }], COLIS);
    expect(g[0].colis).toBe(1);
  });

  it("pack: one component short → no gift", () => {
    expect(computeBonus([pack], [buy("A", 10), buy("B", 10), buy("C", 9)], COLIS)).toEqual([]);
  });

  it("pack bought once → fixed reward once (several GIVE products)", () => {
    const g = computeBonus([pack], [buy("A", 10), buy("B", 10), buy("C", 10)], COLIS);
    expect(g.map((x) => [x.productId, x.colis])).toEqual([["A", 1], ["B", 2]]);
  });

  it("pack bought 2 and 3 times → reward ×2 / ×3", () => {
    const two = computeBonus([pack], [buy("A", 20), buy("B", 20), buy("C", 20)], COLIS);
    expect(two.map((x) => x.colis)).toEqual([2, 4]);
    const three = computeBonus([pack], [buy("A", 30), buy("B", 30), buy("C", 30)], COLIS);
    expect(three.map((x) => x.colis)).toEqual([3, 6]);
  });

  it("pack is limited by the scarcest component", () => {
    const g = computeBonus([pack], [buy("A", 30), buy("B", 20), buy("C", 10)], COLIS);
    expect(g.map((x) => x.colis)).toEqual([1, 2]);
  });

  it("gift lines never count as purchases (no self-trigger / chaining)", () => {
    const lines = [buy("A", 10), { ...buy("A", 5), isBonus: true, bonusRuleId: "r-single" }];
    expect(computeBonus([single], lines, COLIS)[0].colis).toBe(1);
  });

  it("legacy base-as-carton product: gift in the base unit", () => {
    const r: ThreePackRuleLite = {
      id: "r-l", name: "L", mode: "SINGLE", isActive: true,
      items: [{ role: "BUY", productId: "L", colis: 5 }, { role: "GIVE", productId: "L", colis: 1 }],
    };
    const g = computeBonus([r], [{ productId: "L", baseQty: 10 }], COLIS);
    expect(g[0]).toMatchObject({ unitId: "u-base", colis: 2, baseQty: 2 });
  });

  it("inactive rules are skipped unless validating an offline sale", () => {
    const off = { ...single, isActive: false };
    expect(computeBonus([off], [buy("A", 10)], COLIS)).toEqual([]);
    expect(computeBonus([off], [buy("A", 10)], COLIS, { includeInactive: true })).toHaveLength(1);
  });

  it("products with no colis are ignored", () => {
    expect(computeBonus([single], [{ productId: "ZZ", baseQty: 500 }], COLIS)).toEqual([]);
  });
});

describe("3pack — overClaimedBonus (offline sync guard)", () => {
  const claim = (ruleId: string, productId: string, nColis: number) => ({ ...buy(productId, nColis), isBonus: true, bonusRuleId: ruleId });

  it("accepts exactly what was earned", () => {
    expect(overClaimedBonus([single], [buy("A", 20), claim("r-single", "A", 2)], COLIS)).toEqual([]);
  });

  it("accepts a rule that was deactivated after the phone sold", () => {
    expect(overClaimedBonus([{ ...single, isActive: false }], [buy("A", 10), claim("r-single", "A", 1)], COLIS)).toEqual([]);
  });

  it("rejects more than earned", () => {
    const bad = overClaimedBonus([single], [buy("A", 20), claim("r-single", "A", 3)], COLIS);
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({ claimed: 3, allowed: 2 });
  });

  it("rejects a bonus with no purchase behind it, or an unknown rule", () => {
    expect(overClaimedBonus([single], [claim("r-single", "A", 1)], COLIS)).toHaveLength(1);
    expect(overClaimedBonus([single], [buy("A", 10), claim("r-nope", "A", 1)], COLIS)).toHaveLength(1);
  });
});

describe("3pack — colisOf + rule shape", () => {
  it("picks the smallest conversion with factor > 1", () => {
    expect(colisOf({ baseUnitId: "b", conversions: [{ unitId: "fardeau", factor: 120 }, { unitId: "carton", factor: 12 }] })).toEqual({ unitId: "carton", factor: 12 });
  });
  it("legacy base-as-carton → base unit", () => {
    expect(colisOf({ baseUnitId: "carton", conversions: [{ unitId: "piece", factor: 1 / 24 }] })).toEqual({ unitId: "carton", factor: 1 });
  });
  it("no packs → null", () => {
    expect(colisOf({ baseUnitId: "b", conversions: [] })).toBeNull();
  });

  const it_ = (role: "BUY" | "GIVE", productId: string, colis = 1) => ({ role, productId, colis });
  it("validates SINGLE / PACK shapes", () => {
    expect(ruleShapeError("SINGLE", [it_("BUY", "A", 10), it_("GIVE", "A")])).toBeNull();
    expect(ruleShapeError("SINGLE", [it_("BUY", "A", 10), it_("GIVE", "B")])).toBeNull(); // free product can be ANY product
    expect(ruleShapeError("SINGLE", [it_("BUY", "A", 10)])).toBe("rule_single_shape");
    expect(ruleShapeError("PACK", [it_("BUY", "A", 10), it_("BUY", "B", 10), it_("GIVE", "C")])).toBeNull();
    expect(ruleShapeError("PACK", [it_("BUY", "A", 10), it_("GIVE", "C")])).toBe("rule_pack_needs_two");
    expect(ruleShapeError("PACK", [it_("BUY", "A", 10), it_("BUY", "B", 10)])).toBe("rule_needs_gift");
    expect(ruleShapeError("PACK", [it_("BUY", "A", 10), it_("BUY", "A", 10), it_("GIVE", "C")])).toBe("rule_duplicate_product");
    expect(ruleShapeError("SINGLE", [it_("BUY", "A", 0), it_("GIVE", "A")])).toBe("rule_bad_qty");
  });
});
