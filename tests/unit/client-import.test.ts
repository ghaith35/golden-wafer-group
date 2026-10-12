import { describe, expect, it } from "vitest";
import { mapImportHeaders, normalizeImportPhone, shapeImportRows } from "@/lib/clients/import";

describe("normalizeImportPhone", () => {
  it("keeps valid Algerian mobiles", () => {
    expect(normalizeImportPhone("0664328954")).toBe("0664328954");
    expect(normalizeImportPhone("0552908578")).toBe("0552908578");
  });
  it("strips spaces and separators", () => {
    expect(normalizeImportPhone("0779 07 38 05")).toBe("0779073805");
    expect(normalizeImportPhone("0770-885-508")).toBe("0770885508");
  });
  it("handles +213 prefix and numbers", () => {
    expect(normalizeImportPhone("+213664328954")).toBe("0664328954");
    expect(normalizeImportPhone(664328954)).toBe("0664328954");
  });
  it("rejects blanks, landlines and short numbers", () => {
    expect(normalizeImportPhone(null)).toBeNull();
    expect(normalizeImportPhone("")).toBeNull();
    expect(normalizeImportPhone("0234567890")).toBeNull();
    expect(normalizeImportPhone("077644856")).toBeNull();
  });
});

describe("mapImportHeaders", () => {
  it("maps the French export header", () => {
    const cols = mapImportHeaders(["Nom", "Téléphone", "Email", "Adresse", "Dette", "Statut"]);
    expect(cols).toMatchObject({ name: 0, phone: 1, email: 2, address: 3, status: 5 });
  });
  it("requires nothing but tolerates missing name", () => {
    expect(mapImportHeaders(["Foo", "Bar"]).name).toBe(-1);
  });
});

describe("shapeImportRows", () => {
  const cols = { name: 0, phone: 1, email: 2, address: 3, status: 5 };
  it("shapes rows, flags inactive, drops nameless lines", () => {
    const { rows, skippedEmpty } = shapeImportRows(
      [
        ["Aamar", "0664328954", null, null, "x", "Active"],
        ["Aek 2 dourou", "0554192613", null, null, "x", "Inactive"],
        ["", null, null, null, null, null],
      ],
      cols,
      2
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "Aamar", phone: "0664328954", isActive: true, line: 2 });
    expect(rows[1]).toMatchObject({ name: "Aek 2 dourou", isActive: false, line: 3 });
    expect(skippedEmpty).toBe(1);
  });
});
