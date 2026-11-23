import { describe, it, expect } from "vitest";
import { applyDeals, computeDeals, computeBonus, ruleShapeError, type ThreePackRuleLite } from "@/lib/threepack/match";

// Product A, B: carton = 12 pieces (colis factor 12), base = piece.
const colis = { A: { unitId: "ctn", factor: 12 }, B: { unitId: "ctn", factor: 12 }, C: { unitId: "ctn", factor: 6 } };
const line = (productId: string, qty: number, unitPrice: number, factor = 1) => ({
  productId, qty, baseQty: qty * factor, unitPrice, remise: 0, lineTotal: qty * unitPrice,
});

const pct = (buy: Array<[string, number]>, targets: string[], percent: number): ThreePackRuleLite => ({
  id: "p1", name: "-20%", mode: "PERCENT", percent, isActive: true,
  items: [...buy.map(([productId, c]) => ({ role: "BUY" as const, productId, colis: c })), ...targets.map((productId) => ({ role: "GIVE" as const, productId, colis: 1 }))],
});
const price = (buy: Array<[string, number]>, targets: Array<[string, number]>): ThreePackRuleLite => ({
  id: "r1", name: "new price", mode: "PRICE", isActive: true,
  items: [...buy.map(([productId, c]) => ({ role: "BUY" as const, productId, colis: c })), ...targets.map(([productId, p]) => ({ role: "GIVE" as const, productId, colis: 1, price: p }))],
});

describe("price deals", () => {
  it("single → single: buy 10 colis of A, A is 20% off (whole line)", () => {
    const out = applyDeals([pct([["A", 10]], ["A"], 20)], [line("A", 120, 100)], colis); // 120 pieces = 10 colis
    expect(out[0].unitPrice).toBe(80);
    expect(out[0].lineTotal).toBe(9600);
  });
  it("does nothing below the threshold", () => {
    const out = applyDeals([pct([["A", 10]], ["A"], 20)], [line("A", 108, 100)], colis); // 9 colis
    expect(out[0].unitPrice).toBe(100);
  });
  it("pack → single: buy A×5 + B×5, C gets a new price per colis", () => {
    const rules = [price([["A", 5], ["B", 5]], [["C", 600]])];
    const lines = [line("A", 60, 100), line("B", 60, 100), line("C", 12, 120)]; // C: 12 pieces = 2 colis of 6
    const out = applyDeals(rules, lines, colis);
    expect(out[2].unitPrice).toBe(100); // 600 per colis of 6 pieces → 100/piece
    expect(out[2].lineTotal).toBe(1200);
    expect(out[0].unitPrice).toBe(100); // bought products untouched
  });
  it("pack → pack: both targets are discounted when the pack is bought", () => {
    const rules = [pct([["A", 5], ["B", 5]], ["A", "B"], 10)];
    const out = applyDeals(rules, [line("A", 60, 100), line("B", 60, 100)], colis);
    expect(out.map((l) => l.unitPrice)).toEqual([90, 90]);
  });
  it("a pack that is only half bought gives no deal", () => {
    const rules = [pct([["A", 5], ["B", 5]], ["A", "B"], 10)];
    const out = applyDeals(rules, [line("A", 60, 100), line("B", 12, 100)], colis);
    expect(out.map((l) => l.unitPrice)).toEqual([100, 100]);
  });
  it("new price is per colis and scales to the line's unit (sold by carton)", () => {
    const rules = [price([["A", 1]], [["A", 1200]])];
    const carton = { ...line("A", 2, 1500, 12) }; // 2 cartons, unit factor 12
    const out = applyDeals(rules, [carton], colis);
    expect(out[0].unitPrice).toBe(1200); // per carton
    expect(out[0].lineTotal).toBe(2400);
  });
  it("hand-priced lines and gift lines are left alone", () => {
    const rules = [pct([["A", 1]], ["A"], 50)];
    const manual = { ...line("A", 12, 100), manualPrice: true };
    expect(applyDeals(rules, [manual], colis)[0].unitPrice).toBe(100);
    const gift = { ...line("A", 12, 0), isBonus: true };
    expect(applyDeals(rules, [line("A", 12, 100), gift], colis)[1].unitPrice).toBe(0);
  });
  it("the cheapest deal wins when several hit one product", () => {
    const out = applyDeals([pct([["A", 1]], ["A"], 10), price([["A", 1]], [["A", 900]])], [line("A", 12, 100)], colis);
    expect(out[0].unitPrice).toBe(75); // 900/12 beats 10% off 100
  });
  it("respects the promotion window and the on/off switch", () => {
    const r = { ...pct([["A", 1]], ["A"], 50), endsAt: new Date(2026, 0, 1).toISOString() };
    expect(computeDeals([r], [{ productId: "A", baseQty: 12 }], colis, { now: new Date(2026, 5, 1) })).toHaveLength(0);
    expect(computeDeals([{ ...r, isActive: false, endsAt: null }], [{ productId: "A", baseQty: 12 }], colis)).toHaveLength(0);
  });
  it("deal rules never produce free goods", () => {
    expect(computeBonus([pct([["A", 1]], ["A"], 50)], [{ productId: "A", baseQty: 12 }], colis)).toHaveLength(0);
  });
});

describe("deal rule shape", () => {
  const it2 = (role: "BUY" | "GIVE", productId: string, colis = 1, price?: number) => ({ role, productId, colis, price });
  it("accepts single/pack buy with single/pack targets", () => {
    expect(ruleShapeError("PERCENT", [it2("BUY", "A", 10), it2("GIVE", "B")], 15)).toBeNull();
    expect(ruleShapeError("PERCENT", [it2("BUY", "A", 5), it2("BUY", "B", 5), it2("GIVE", "C"), it2("GIVE", "A")], 15)).toBeNull();
    expect(ruleShapeError("PRICE", [it2("BUY", "A", 5), it2("GIVE", "C", 1, 500)])).toBeNull();
  });
  it("rejects bad percent, missing price and missing sides", () => {
    expect(ruleShapeError("PERCENT", [it2("BUY", "A"), it2("GIVE", "B")], 0)).toBe("rule_bad_percent");
    expect(ruleShapeError("PERCENT", [it2("BUY", "A"), it2("GIVE", "B")], 120)).toBe("rule_bad_percent");
    expect(ruleShapeError("PRICE", [it2("BUY", "A"), it2("GIVE", "B")])).toBe("rule_bad_price");
    expect(ruleShapeError("PRICE", [it2("GIVE", "B", 1, 10)])).toBe("rule_needs_buy");
    expect(ruleShapeError("PRICE", [it2("BUY", "A")])).toBe("rule_needs_target");
  });
});
