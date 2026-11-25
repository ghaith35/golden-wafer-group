import { describe, expect, it } from "vitest";
import { isDetailTierName, normalizeTierName, pickDefaultTierId } from "@/lib/clients/tier-default";

describe("normalizeTierName", () => {
  it("strips accents and case", () => {
    expect(normalizeTierName("détail")).toBe("detail");
    expect(normalizeTierName("Prix de détail")).toBe("prix de detail");
    expect(normalizeTierName("  Gros ")).toBe("gros");
  });
});

describe("isDetailTierName", () => {
  it("matches détail in any form, never gros", () => {
    expect(isDetailTierName("détail")).toBe(true);
    expect(isDetailTierName("Prix de détail")).toBe(true);
    expect(isDetailTierName("DETAIL")).toBe(true);
    expect(isDetailTierName("Prix de gros")).toBe(false);
    expect(isDetailTierName("Prix super gros")).toBe(false);
    expect(isDetailTierName("gros")).toBe(false);
  });
});

describe("pickDefaultTierId (new-client price default)", () => {
  it("prefers the détail tier even when gros is sorted first", () => {
    const tiers = [
      { id: "g", name: "gros" },
      { id: "d", name: "détail" },
      { id: "s", name: "super gros" },
    ];
    expect(pickDefaultTierId(tiers)).toBe("d");
  });
  it("matches prefixed names like Prix de détail", () => {
    const tiers = [
      { id: "g", name: "Prix de gros" },
      { id: "s", name: "Prix super gros" },
      { id: "d", name: "Prix de détail" },
    ];
    expect(pickDefaultTierId(tiers)).toBe("d");
  });
  it("falls back to the first tier when there is no détail", () => {
    expect(pickDefaultTierId([{ id: "g", name: "gros" }])).toBe("g");
  });
  it("returns null when there are no tiers", () => {
    expect(pickDefaultTierId([])).toBeNull();
  });
});
