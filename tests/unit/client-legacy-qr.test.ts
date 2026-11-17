import { afterEach, describe, expect, it, vi } from "vitest";
import { parseClientScan } from "@/lib/clients/qr";
import { clientQrPayload, legacyQrSchema } from "@/lib/clients/validation";
import { findScannedClient } from "@/lib/sync/client";

const company = "shop-one";
const oldQr = "https://old.example/client/CLT-0001?branch=western";
const client = {
  id: "client-two",
  code: "CLT-0002",
  name: "Client Two",
  phone: null,
  tierId: null,
  balance: 0,
  legacyQr: oldQr,
};

afterEach(() => vi.unstubAllGlobals());

describe("legacy client QR", () => {
  it("uses the entire old QR and keeps native QR codes company-scoped", () => {
    expect(parseClientScan(oldQr, company)).toEqual({ legacyQr: oldQr });
    expect(parseClientScan(clientQrPayload(company, client.code), company)).toEqual({ code: client.code });
    expect(parseClientScan(clientQrPayload("another-shop", client.code), company)).toBeNull();
    expect(parseClientScan(client.code, company)).toEqual({ code: client.code });
    expect(legacyQrSchema.safeParse(client.code).success).toBe(false);
    expect(legacyQrSchema.safeParse(clientQrPayload(company, client.code)).success).toBe(false);
    expect(legacyQrSchema.parse(null)).toBeNull();
  });

  it("sends the full scan in the scoped online lookup", async () => {
    const fetch = vi.fn(async () => Response.json(client));
    vi.stubGlobal("fetch", fetch);
    expect(await findScannedClient(oldQr, company)).toEqual(client);
    expect(fetch).toHaveBeenCalledWith("/api/clients/qr-lookup", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ qr: oldQr }),
    }));
  });

  it("finds the confirmed old QR from the phone snapshot during an outage", async () => {
    const snapshot = JSON.stringify({ company: { id: company }, clients: [client] });
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", { getItem: (key: string) => key === "dili_snapshot_v1" ? snapshot : null });
    vi.stubGlobal("fetch", async () => new Response(null, { status: 530 }));
    expect(await findScannedClient(oldQr, company)).toEqual(client);
    expect(await findScannedClient(clientQrPayload(company, client.code), company)).toEqual(client);
    expect(await findScannedClient(oldQr.replace("western", "eastern"), company)).toBeNull();
    expect(await findScannedClient(oldQr, "another-shop")).toBeNull();
  });
});
