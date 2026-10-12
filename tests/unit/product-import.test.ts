import { describe, expect, it } from "vitest";
import { mapProductHeaders, parseImportPrice, parseImportStock, shapeProductRows } from "@/lib/products/import";

describe("parseImportPrice", () => {
  it("parses French formatted amounts", () => {
    expect(parseImportPrice("51,00 DA")).toBe(51);
    expect(parseImportPrice("67,50 DA")).toBe(67.5);
    expect(parseImportPrice("1 250,00 DA")).toBe(1250);
    expect(parseImportPrice("1.250,50")).toBe(1250.5);
  });
  it("parses plain numbers", () => {
    expect(parseImportPrice(75)).toBe(75);
    expect(parseImportPrice("80.00")).toBe(80);
    expect(parseImportPrice(null)).toBe(0);
    expect(parseImportPrice("")).toBe(0);
  });
});

describe("parseImportStock", () => {
  it("parses quantities", () => {
    expect(parseImportStock("639")).toBe(639);
    expect(parseImportStock(4099)).toBe(4099);
    expect(parseImportStock("0")).toBeNull();
    expect(parseImportStock(null)).toBeNull();
  });
});

describe("mapProductHeaders", () => {
  it("maps the French export header", () => {
    const cols = mapProductHeaders(["Désignation", "Référence", "Code-barres", "Prix d'achat", "Prix de vente", "Stock", "Statut"]);
    expect(cols).toMatchObject({ name: 0, reference: 1, barcode: 2, cost: 3, sale: 4, stock: 5, status: 6 });
  });
});

describe("shapeProductRows", () => {
  const cols = { name: 0, reference: 1, barcode: 2, cost: 3, sale: 4, stock: 5, status: 6 };
  it("shapes rows with prices, stock and status", () => {
    const { rows, skippedEmpty } = shapeProductRows(
      [
        ["CROUS CP", "CRO059", null, "51,00 DA", "75,00 DA", "639", "Actif"],
        ["CROUS FRG", "CRO059", null, "51,00 DA", "75,00 DA", "0", "Inactif"],
      ],
      cols,
      2
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "CROUS CP", reference: "CRO059", costPrice: 51, salePrice: 75, stock: 639, isActive: true });
    expect(rows[1]).toMatchObject({ stock: null, isActive: false });
    expect(skippedEmpty).toBe(0);
  });
});
