import { describe, expect, it } from "vitest";
import { pdfAr, pdfArLtr } from "@/lib/pdf/arabicPdf";

describe("pdfArLtr (French invoice, LTR base)", () => {
  it("leaves pure French untouched", () => {
    expect(pdfArLtr("Total : 11 201,00 DA")).toBe("Total : 11 201,00 DA");
    expect(pdfArLtr("N° CMD-0005")).toBe("N° CMD-0005");
  });

  it("keeps French word order around Arabic names", () => {
    const out = pdfArLtr("Client : محمد (CLT-0001)");
    expect(out.startsWith("Client : ")).toBe(true);
    expect(out.endsWith("(CLT-0001)")).toBe(true);
  });

  it("does not fully reverse mixed lines (unlike the RTL-base helper)", () => {
    const mixed = "Client : محمد";
    expect(pdfArLtr(mixed).startsWith("Client")).toBe(true);
    expect(pdfAr(mixed).startsWith("Client")).toBe(false);
  });

  it("pure Arabic still reads correctly (RTL run reversed)", () => {
    expect(pdfArLtr("منتج تجريبي")).toBe(pdfAr("منتج تجريبي"));
  });
});
