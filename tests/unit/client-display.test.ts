import { describe, it, expect } from "vitest";
import { matchClient, normSearch, clientMapsUrl, clientLabel } from "@/lib/clients/display";

describe("client display helpers", () => {
  it("search ignores case, accents, Arabic spelling variants", () => {
    expect(matchClient("mini", { name: "Mini Shop Malak" })).toBe(true);
    expect(matchClient("MALAK shop", { name: "Mini shop malak" })).toBe(true);
    expect(matchClient("احمد", { name: "أحمد بن علي" })).toBe(true);
    expect(matchClient("cafe", { name: "Café Étoile" })).toBe(true);
    expect(matchClient("clt-mwq", { name: "x", code: "CLT-MWQ4ST2S" })).toBe(true);
    expect(matchClient("0659", { name: "x", phone: "0659637087" })).toBe(true);
    expect(matchClient("zzz", { name: "Mini" })).toBe(false);
    expect(matchClient("  ", { name: "Mini" })).toBe(true);
    expect(normSearch("ـأ")).toBe("ا");
  });
  it("maps url needs real coordinates", () => {
    expect(clientMapsUrl(36.75, 3.06)).toBe("https://www.google.com/maps/search/?api=1&query=36.75,3.06");
    expect(clientMapsUrl("36.75", "3.06")).not.toBeNull();
    expect(clientMapsUrl(null, 3)).toBeNull();
    expect(clientMapsUrl(0, 0)).toBeNull();
    expect(clientMapsUrl(120, 3)).toBeNull();
  });
  it("one fallback rule", () => {
    expect(clientLabel("  ")).toBe("—");
    expect(clientLabel(null, "Comptoir")).toBe("Comptoir");
    expect(clientLabel(" Ali ")).toBe("Ali");
  });
});
