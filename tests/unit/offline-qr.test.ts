import { beforeEach, describe, expect, it, vi } from "vitest";

// QR badge offline unlock: drivers who always log in by scan have no
// password to cache — the badge itself is cached at the last online QR
// login and unlocks later with zero connection.

function installFakeStorage() {
  const store = new Map<string, string>();
  const fake = {
    getItem: vi.fn((k: string) => (store.has(k) ? store.get(k)! : null)),
    setItem: vi.fn((k: string, v: string) => void store.set(k, v)),
    removeItem: vi.fn((k: string) => void store.delete(k)),
  };
  vi.stubGlobal("localStorage", fake);
  vi.stubGlobal("window", { localStorage: fake });
  return fake;
}

describe("offline QR credential", () => {
  beforeEach(async () => {
    vi.resetModules();
    installFakeStorage();
    vi.stubGlobal("Capacitor", undefined);
  });

  it("saves on QR login, unlocks by scan, rejects strangers", async () => {
    const m = await import("@/lib/sync/client");
    expect(m.saveOfflineQr("tok-abc", "ghaith", "Livreur")).toBe(true);
    const ok = m.tryOfflineQrUnlock("tok-abc");
    expect(ok).toMatchObject({ ok: true, username: "ghaith", role: "Livreur" });
    expect(m.tryOfflineQrUnlock("tok-xyz")).toMatchObject({ ok: false, error: "bad" });
    expect(m.hasOfflineUnlock()).toBe(true);
  });

  it("refuses empty token/username and Admin badges", async () => {
    const m = await import("@/lib/sync/client");
    expect(m.saveOfflineQr("", "x", "Livreur")).toBe(false);
    expect(m.saveOfflineQr("t", "", "Livreur")).toBe(false);
    expect(m.saveOfflineQr("t", "boss", "Admin")).toBe(false);
    expect(m.tryOfflineQrUnlock("t")).toMatchObject({ ok: false, error: "no_cache" });
  });

  it("accepts a saved badge after a year offline", async () => {
    const f = installFakeStorage();
    const m = await import("@/lib/sync/client");
    expect(m.saveOfflineQr("tok-abc", "ghaith", "Livreur")).toBe(true);
    const raw = JSON.parse(f.getItem("dili_offline_qr_v1") as string);
    raw.cachedAt = Date.now() - 365 * 24 * 60 * 60 * 1000;
    f.setItem("dili_offline_qr_v1", JSON.stringify(raw));
    expect(m.getOfflineQr()?.username).toBe("ghaith");
    expect(m.tryOfflineQrUnlock("tok-abc")).toMatchObject({ ok: true });
  });

  it("logout wipes the QR mapping too", async () => {
    const m = await import("@/lib/sync/client");
    expect(m.saveOfflineQr("tok-abc", "ghaith", "Livreur")).toBe(true);
    m.clearOfflineCred();
    expect(m.tryOfflineQrUnlock("tok-abc")).toMatchObject({ ok: false, error: "no_cache" });
  });
});
