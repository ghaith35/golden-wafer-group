import { describe, expect, it } from "vitest";
import {
  breakdownNested,
  buildColisageText,
  draftFromConversions,
  levelLabel,
  mixedColisTotal,
  previewFactors,
} from "@/lib/products/colisage";

describe("colisage — pack math shown on phone + printed docs", () => {
  it("unite mode → no text", () => {
    expect(buildColisageText("Bouteille", { mode: "unite", l1Name: "Carton", l1Qty: 24, l1Barcode: "", l2Name: "", l2Qty: "", l2Barcode: "" })).toBeNull();
  });

  it("simple: 1 Carton = 24 Bouteille", () => {
    expect(buildColisageText("Bouteille", { mode: "simple", l1Name: "Carton", l1Qty: 24, l1Barcode: "", l2Name: "", l2Qty: "", l2Barcode: "" })).toBe("1 Carton = 24 Bouteille");
  });

  it("double: 1 Fardeau = 10 Carton (240 Bouteille)", () => {
    expect(
      buildColisageText("Bouteille", { mode: "double", l1Name: "Carton", l1Qty: 24, l1Barcode: "", l2Name: "Fardeau", l2Qty: 10, l2Barcode: "" })
    ).toBe("1 Fardeau = 10 Carton (240 Bouteille)");
  });

  it("previewFactors: L2 = N1*N2", () => {
    expect(previewFactors({ mode: "double", l1Name: "Carton", l1Qty: 24, l1Barcode: "", l2Name: "Fardeau", l2Qty: 10, l2Barcode: "" })).toEqual({ n1: 24, n2: 10, total: 240 });
  });

  it("draftFromConversions: single pack → simple", () => {
    const d = draftFromConversions([{ unitId: "u1", factor: 12, unit: { name: "Carton" } }], () => "?");
    expect(d).toMatchObject({ mode: "simple", l1Name: "Carton", l1Qty: 12 });
  });

  it("draftFromConversions: ignores factor<=1 legacy rows", () => {
    const d = draftFromConversions([{ unitId: "u1", factor: 0.0833 }], () => "?");
    expect(d.mode).toBe("unite");
  });

  it("levelLabel expresses each pack in the unit directly below", () => {
    const packs = [{ name: "علبة", factor: 1 }, { name: "فاردو", factor: 6 }, { name: "منصة", factor: 180 }];
    expect(levelLabel(packs.slice(1), 0, "علبة")).toContain("فاردو");
    expect(levelLabel(packs.slice(1), 1, "علبة")).toContain("فاردو");
    expect(levelLabel(packs.slice(1), 1, "علبة")).not.toContain("180 علبة");
  });

  it("breakdownNested: 2 Grand + rest", () => {
    const s = breakdownNested(500, "Bouteille", { name: "Carton", factor: 24 }, { name: "Grand", factor: 240 } as any);
    expect(s).toContain("2 Grand");
  });

  it("mixedColisTotal: same pack name summed, different → كولي", () => {
    const same = mixedColisTotal([
      { qty: 48, packsAsc: [{ name: "كرتون", factor: 24 }] },
      { qty: 24, packsAsc: [{ name: "كرتون", factor: 24 }] },
    ]);
    expect(same).toMatchObject({ packs: 3, packName: "كرتون", units: 72 });
    const mixed = mixedColisTotal([
      { qty: 24, packsAsc: [{ name: "كرتون", factor: 24 }] },
      { qty: 12, packsAsc: [{ name: "علبة", factor: 6 }] },
    ]);
    expect(mixed.packName).toBe("كولي");
  });
});
