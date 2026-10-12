import { describe, expect, it, vi } from "vitest";
import { ticketPrintHtml } from "@/lib/print-ticket";
import { buildTicketPdf } from "@/lib/pdf/ticketPdf";
import { sharePdfFile } from "@/lib/share-ticket";
import type { TicketLabels, TicketVM } from "@/components/sales/TicketView";

const labels = {
  total: "Total", paid: "Payé", due: "Reste", remise: "Remise", thanks: "Merci",
} as TicketLabels;

const ticket = {
  number: "F-12",
  date: "2026-10-08T10:00:00.000Z",
  total: 1500,
  paid: 1000,
  remise: 0,
  client: { name: "Ahmed", code: "CLT-1", phone: "0550123456" },
  location: { name: "Camion" },
  lines: [
    { name: "Produit A", qty: 2, unitPrice: 500, lineTotal: 1000 },
    { name: "زيت الزيتون", qty: 1, unitPrice: 500, lineTotal: 500 },
  ],
} as unknown as TicketVM;

describe("ticketPrintHtml (native thermal print)", () => {
  it("renders a self-contained page with @page size", () => {
    const html = ticketPrintHtml(ticket, { name: "SARL Test" }, "80", labels, "ar");
    expect(html).toContain("@page{size:80mm auto");
    expect(html).toContain("SARL Test");
    expect(html).toContain("F-12");
    expect(html).toContain("Ahmed");
    expect(html).toContain("Produit A");
    expect(html).toContain("1500");
  });

  it("escapes HTML in names", () => {
    const evil = { ...ticket, client: { name: "<img src=x>", code: "1", phone: null } } as unknown as TicketVM;
    const html = ticketPrintHtml(evil, { name: "Co" }, "58", labels, "fr");
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;img src=x&gt;");
    expect(html).toContain('dir="ltr"');
  });
});

describe("buildTicketPdf (A4 facture, offline)", () => {
  it("builds a valid PDF with Arabic + Latin lines, no logo/fonts needed", async () => {
    const blob = await buildTicketPdf({
      ticket,
      company: { name: "SARL Test", phone: "023456789", address: "Alger", rc: "123", nif: "456", logoUrl: null },
      lang: "ar",
      labels,
      qrDataUrl: null,
    });
    expect(blob.type).toBe("application/pdf");
    const head = Buffer.from(await blob.slice(0, 5).arrayBuffer()).toString("latin1");
    expect(head).toBe("%PDF-");
    expect(blob.size).toBeGreaterThan(5000);
  });

  it("long tickets stay one valid file, works without client", async () => {
    const many = {
      ...ticket,
      client: null,
      lines: Array.from({ length: 60 }, (_, i) => ({ name: `P${i}`, qty: 1, unitPrice: 10, lineTotal: 10 })),
      total: 600,
      paid: 600,
    } as unknown as TicketVM;
    const blob = await buildTicketPdf({ ticket: many, company: { name: "Co" }, lang: "fr", labels });
    const head = Buffer.from(await blob.slice(0, 5).arrayBuffer()).toString("latin1");
    expect(head).toBe("%PDF-");
    expect(blob.size).toBeGreaterThan(5000);
  });
});

describe("sharePdfFile (save/share contract)", () => {
  it("no window → failed, never throws", async () => {
    await expect(
      sharePdfFile({ fileName: "x.pdf", blob: new Blob(["a"]), title: "t" })
    ).resolves.toBe("failed");
  });

  it("browser without Web-Share → download → saved", async () => {
    const clicked: string[] = [];
    vi.stubGlobal("window", { setTimeout: (fn: () => void) => fn() });
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", {
      createElement: () => ({ click: () => clicked.push("x"), remove: () => {}, set href(_v: string) {}, set download(_v: string) {} }),
      body: { appendChild: () => {} },
    });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    const r = await sharePdfFile({ fileName: "f.pdf", blob: new Blob(["a"]), title: "t" });
    expect(r).toBe("saved");
    expect(clicked).toEqual(["x"]);
    vi.unstubAllGlobals();
  });
});
