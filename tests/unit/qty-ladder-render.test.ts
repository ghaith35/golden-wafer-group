import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../src/locales/en.json";
import ar from "../../src/locales/ar.json";
import { QtyLadder } from "@/components/products/QtyLadder";
import { QtyLadderHint } from "@/components/sales/QtyLadderHint";

const wrap = (locale: "en" | "ar", node: React.ReactElement) =>
  renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: locale === "en" ? en : ar, children: node } as never));

const tiers = [{ id: "g", name: "Wholesale" }, { id: "s", name: "Super wholesale" }];
const tierPrices = [{ tierId: "g", price: 110 }, { tierId: "s", price: 100 }];
const priceOfTier = (id: string | null) => (id ? (tierPrices.find((x) => x.tierId === id)?.price ?? 120) : 120);

describe("QtyLadder builder renders", () => {
  const props = {
    units: [{ key: "l1", label: "Carton", factor: 12 }, { key: "base", label: "Bottle", factor: 1 }],
    tiers, baseLabel: "Sale price", priceOfTier, hasTierPrice: (id: string) => tierPrices.some((x) => x.tierId === id), onChange: () => {},
  };
  it("shows the ladder: ranges, tiers and per-carton prices", () => {
    const html = wrap("en", createElement(QtyLadder, { ...props, value: { l1: [{ minQty: 0, tierId: null }, { minQty: 10, tierId: "g" }, { minQty: 50, tierId: "s" }] } }));
    expect(html).toContain("Carton");
    expect(html).toContain("1 – 9");
    expect(html).toContain("10 – 49");
    expect(html).toContain("50 and up");
    expect(html).toContain("Super wholesale");
    expect(html).toMatch(/1[\s\u00a0\u202f]440/); // 120 × 12
    expect(html).toMatch(/1[\s\u00a0\u202f]200/); // 100 × 12
    expect(html).toContain('role="slider"'); // draggable dividers
  });
  it("collapsed (off) units render just the switch; Arabic renders too", () => {
    const off = wrap("en", createElement(QtyLadder, { ...props, value: {} }));
    expect(off).toContain('role="switch"');
    expect(off).not.toContain('role="slider"');
    const rtl = wrap("ar", createElement(QtyLadder, { ...props, baseLabel: "سعر البيع", value: { l1: [{ minQty: 0, tierId: null }, { minQty: 10, tierId: "g" }] } }));
    expect(rtl).toContain("فأكثر");
  });
  it("warns when a tier has no price on this product", () => {
    const html = wrap("en", createElement(QtyLadder, { ...props, hasTierPrice: () => false, value: { l1: [{ minQty: 0, tierId: null }, { minQty: 10, tierId: "g" }] } }));
    expect(html).toContain("no price in that tier");
  });
});

describe("QtyLadderHint on a sale line", () => {
  const product = {
    baseUnitId: "b", salePrice: 120, tierPrices,
    conversions: [{ unitId: "ctn", factor: 12 }],
    qtyTiers: [{ unitKey: "ctn", minQty: 0, tierId: null }, { unitKey: "ctn", minQty: 10, tierId: "g" }, { unitKey: "ctn", minQty: 50, tierId: "s" }],
  };
  const hint = (qty: number, unitId = "ctn") =>
    wrap("en", createElement(QtyLadderHint, { product, unitId, qty, fallbackTierId: null, tierName: (id: string | null) => (id ? (tiers.find((x) => x.id === id)?.name ?? "") : "Sale price") }));
  it("names the active tier and says how many more unlock the next price", () => {
    const h = hint(7);
    expect(h).toContain("Sale price");
    expect(h).toContain("Add 3 to get Wholesale (−8%)");
  });
  it("re-tiers at the threshold", () => {
    expect(hint(10)).toContain("Wholesale");
    expect(hint(10)).toContain("Add 40 to get Super wholesale");
    expect(hint(50)).not.toContain("Add ");
  });
  it("renders nothing for a unit without a ladder or qty 0", () => {
    expect(hint(5, "b")).toBe("");
    expect(hint(0)).toBe("");
  });
});
