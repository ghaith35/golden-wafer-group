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
