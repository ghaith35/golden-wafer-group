import { beforeEach, describe, expect, it, vi } from "vitest";

// Web outbox driver persists to localStorage key dili_outbox_v1.
// Phone data must survive refresh + failed syncs. Test with a fake storage.

function installFakeLocalStorage() {
  const store = new Map<string, string>();
  const fake = {
    getItem: vi.fn((k: string) => (store.has(k) ? store.get(k)! : null)),
    setItem: vi.fn((k: string, v: string) => void store.set(k, v)),
    removeItem: vi.fn((k: string) => void store.delete(k)),
    clear: () => store.clear(),
    _store: store,
  };
  vi.stubGlobal("localStorage", fake);
  vi.stubGlobal("window", { localStorage: fake });
  return fake;
}

describe("offline outbox persistence (web driver)", () => {
  let ls: ReturnType<typeof installFakeLocalStorage>;

  beforeEach(async () => {
    vi.resetModules();
    ls = installFakeLocalStorage();
    vi.stubGlobal("Capacitor", undefined);
  });

  it("put → list → remove round-trips ops", async () => {
    const { db } = await import("@/lib/sync/offline-db");
    await db.outboxPut({ opId: "op-00000001", kind: "ticket", payload: { a: 1 }, ts: 1, attempts: 0, nextRetryAt: 0 });
    await db.outboxPut({ opId: "op-00000002", kind: "versement", payload: {}, ts: 2, attempts: 0, nextRetryAt: 0 });
    const rows = await db.outboxList();
    expect(rows.map((r) => r.opId).sort()).toEqual(["op-00000001", "op-00000002"]);

    await db.outboxRemove("op-00000001");
    const after = await db.outboxList();
    expect(after.map((r) => r.opId)).toEqual(["op-00000002"]);
  });

  it("upsert by opId: retry update does not duplicate", async () => {
    const { db } = await import("@/lib/sync/offline-db");
    await db.outboxPut({ opId: "op-dup-00001", kind: "ticket", payload: {}, ts: 1, attempts: 0, nextRetryAt: 0 });
    await db.outboxPut({ opId: "op-dup-00001", kind: "ticket", payload: {}, ts: 1, attempts: 1, nextRetryAt: 123, error: "x" });
    const rows = await db.outboxList();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ attempts: 1, error: "x" });
  });

  it("corrupt JSON in storage → empty list, never throws (phone must still boot)", async () => {
    ls._store.set("dili_outbox_v1", "not-json{{{");
    const { db } = await import("@/lib/sync/offline-db");
    await expect(db.outboxList()).resolves.toEqual([]);
  });

  it("rows missing opId/kind are skipped, valid rows kept", async () => {
    ls._store.set("dili_outbox_v1", JSON.stringify([{ opId: 1 }, { kind: "ticket" }, { opId: "good-00001", kind: "ticket", payload: {} }]));
    const { db } = await import("@/lib/sync/offline-db");
    const rows = await db.outboxList();
    expect(rows.map((r) => r.opId)).toEqual(["good-00001"]);
  });

  it("kv snapshot round-trip", async () => {
    const { db } = await import("@/lib/sync/offline-db");
    await db.kvSet("dili_snapshot_v1", JSON.stringify({ products: [] }));
    expect(await db.kvGet("dili_snapshot_v1")).toBe(JSON.stringify({ products: [] }));
    await db.kvDel("dili_snapshot_v1");
    expect(await db.kvGet("dili_snapshot_v1")).toBeNull();
  });
});

describe("offline login credential cache", () => {
  function mem() {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  }

  it("saves staff creds, refuses Admin", async () => {
    const { saveOfflineCred, getOfflineCred } = await import("@/lib/sync/client");
    const s = mem();
    expect(saveOfflineCred("ahmed", "ahmed2002", "Livreur", s)).toBe(true);
    expect(getOfflineCred(s)?.username).toBe("ahmed");
    expect(saveOfflineCred("boss", "x", "Admin", mem())).toBe(false);
  });

  it("unlock succeeds on exact match (username case-insensitive), fails otherwise", async () => {
    const { saveOfflineCred, tryOfflineUnlock } = await import("@/lib/sync/client");
    const s = mem();
    saveOfflineCred("ahmed", "ahmed2002", "Livreur", s);
    expect(tryOfflineUnlock("AHMED", "ahmed2002", s)).toMatchObject({ ok: true });
    expect(tryOfflineUnlock("ahmed", "wrong", s)).toMatchObject({ ok: false, error: "bad" });
    expect(tryOfflineUnlock("someone", "ahmed2002", s)).toMatchObject({ ok: false, error: "bad" });
  });

  it("locks for 30s after 5 bad tries, then recovers", async () => {
    const { saveOfflineCred, tryOfflineUnlock } = await import("@/lib/sync/client");
    const s = mem();
    saveOfflineCred("ahmed", "ahmed2002", "Livreur", s);
    for (let i = 0; i < 4; i++) expect(tryOfflineUnlock("ahmed", "no", s).error).toBe("bad");
    const fifth = tryOfflineUnlock("ahmed", "no", s);
    expect(fifth.error).toBe("locked");
    expect(fifth.lockedUntil).toBeGreaterThan(Date.now());
    // Even the right password is rejected while locked…
    expect(tryOfflineUnlock("ahmed", "ahmed2002", s).error).toBe("locked");
    // …and works after the lock expires.
    const raw = s.getItem("dili_offline_fails_v1")!;
    const parsed = JSON.parse(raw);
    parsed.until = Date.now() - 1;
    s.setItem("dili_offline_fails_v1", JSON.stringify(parsed));
    expect(tryOfflineUnlock("ahmed", "ahmed2002", s)).toMatchObject({ ok: true });
  });

  it("expired cache (30d+) behaves as no cache", async () => {
    const { saveOfflineCred, getOfflineCred, tryOfflineUnlock } = await import("@/lib/sync/client");
    const s = mem();
    saveOfflineCred("ahmed", "ahmed2002", "Livreur", s);
    const raw = JSON.parse(s.getItem("dili_offline_cred_v1")!);
    raw.cachedAt = Date.now() - 31 * 24 * 60 * 60 * 1000;
    s.setItem("dili_offline_cred_v1", JSON.stringify(raw));
    expect(getOfflineCred(s)).toBeNull();
    expect(tryOfflineUnlock("ahmed", "ahmed2002", s)).toMatchObject({ ok: false, error: "no_cache" });
  });

  it("clearOfflineCred wipes everything (logout/reset path)", async () => {
    const { saveOfflineCred, clearOfflineCred, getOfflineCred, tryOfflineUnlock } = await import(
      "@/lib/sync/client"
    );
    const s = mem();
    saveOfflineCred("ahmed", "ahmed2002", "Livreur", s);
    expect(tryOfflineUnlock("ahmed", "ahmed2002", s)).toMatchObject({ ok: true });
    clearOfflineCred(s);
    expect(getOfflineCred(s)).toBeNull();
    expect(tryOfflineUnlock("ahmed", "ahmed2002", s)).toMatchObject({ ok: false, error: "no_cache" });
  });
});

describe("pending clients for offline selling", () => {
  it("lists queued client creations for picker merge", async () => {
    installFakeLocalStorage();
    const { db } = await import("@/lib/sync/offline-db");
    const { getPendingClients } = await import("@/lib/sync/client");
    await db.outboxPut({
      opId: "op-cli-1", kind: "client",
      payload: { name: "Hanout Test", code: "CLT-XYZ-1", phone: "0551", tierId: "t1" },
      ts: 1, attempts: 0, nextRetryAt: 0,
    });
    await db.outboxPut({
      opId: "op-t1", kind: "ticket",
      payload: { clientId: "pending:op-cli-1", lines: [] },
      ts: 2, attempts: 0, nextRetryAt: 0,
    });
    const pend = await getPendingClients();
    expect(pend).toHaveLength(1);
    expect(pend[0]).toMatchObject({ opId: "op-cli-1", code: "CLT-XYZ-1", name: "Hanout Test", tierId: "t1" });
    // Engine reference format for the follow-up ops.
    expect(`pending:${pend[0].opId}`).toBe("pending:op-cli-1");
  });

  it("ignores client ops without a minted code", async () => {
    installFakeLocalStorage();
    const { db } = await import("@/lib/sync/offline-db");
    const { getPendingClients } = await import("@/lib/sync/client");
    await db.outboxPut({ opId: "op-cli-2", kind: "client", payload: { name: "No Code" }, ts: 1, attempts: 0, nextRetryAt: 0 });
    expect(await getPendingClients()).toHaveLength(0);
  });
});
