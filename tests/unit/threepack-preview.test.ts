import { describe, expect, it } from "vitest";
import { boughtForCombos, simulateGifts } from "@/lib/threepack/preview";

// The builder's live preview must agree with the real matcher.
describe("gifted pack — live preview", () => {
  const single = { buys: [{ productId: "A", colis: 10 }], gives: [{ productId: "A", colis: 1 }] };
  const pack = {
    buys: [{ productId: "A", colis: 10 }, { productId: "B", colis: 10 }, { productId: "C", colis: 10 }],
    gives: [{ productId: "A", colis: 1 }, { productId: "B", colis: 2 }],
  };

  it("single: 9 → nothing, 10 → 1, 25 → 2", () => {
    expect(simulateGifts(single.buys, single.gives, { A: 9 })).toEqual([]);
    expect(simulateGifts(single.buys, single.gives, { A: 10 })).toEqual([{ productId: "A", colis: 1 }]);
    expect(simulateGifts(single.buys, single.gives, { A: 25 })).toEqual([{ productId: "A", colis: 2 }]);
  });

  it("pack: the combo bought once / twice / three times", () => {
    for (const n of [1, 2, 3]) {
      const g = simulateGifts(pack.buys, pack.gives, boughtForCombos(pack.buys, n));
      expect(g).toEqual([{ productId: "A", colis: 1 * n }, { productId: "B", colis: 2 * n }]);
    }
  });

  it("the free product can differ from the bought one", () => {
    expect(simulateGifts([{ productId: "A", colis: 5 }], [{ productId: "W", colis: 2 }], { A: 10 })).toEqual([{ productId: "W", colis: 4 }]);
  });

  it("an incomplete rule previews nothing (never throws)", () => {
    expect(simulateGifts([], pack.gives, {})).toEqual([]);
    expect(simulateGifts(pack.buys, [{ productId: "", colis: 1 }], boughtForCombos(pack.buys, 1))).toEqual([]);
    expect(simulateGifts([{ productId: "A", colis: 0 }], pack.gives, { A: 5 })).toEqual([]);
  });

  it("boughtForCombos scales every product", () => {
    expect(boughtForCombos(pack.buys, 2)).toEqual({ A: 20, B: 20, C: 20 });
  });
});
