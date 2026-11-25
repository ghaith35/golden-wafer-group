import { describe, expect, it } from "vitest";
import { normalizeTierName, pickDefaultTierId } from "@/lib/clients/tier-default";

describe("normalizeTierName", () => {
  it("strips accents and case", () => {
    expect(normalizeTierName("détail")).toBe("detail");
    expect(normalizeTierName("DÉTAIL")).toBe("detail");
    expect(normalizeTierName("  Gros ")).toBe("gros");
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
  it("falls back to the first tier when there is no détail", () => {
    expect(pickDefaultTierId([{ id: "g", name: "gros" }])).toBe("g");
  });
  it("returns null when there are no tiers", () => {
    expect(pickDefaultTierId([])).toBeNull();
  });
});
