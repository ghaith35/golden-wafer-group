import { beforeEach, describe, expect, it, vi } from "vitest";

// A ticket made offline must show its free colis in the "pending docs" list
// (open / print / share before it ever syncs), at price 0 and flagged as gift.

function installFakes() {
  const ls = new Map<string, string>();
  const store = (m: Map<string, string>) => ({
    getItem: vi.fn((k: string) => (m.has(k) ? m.get(k)! : null)),
    setItem: vi.fn((k: string, v: string) => void m.set(k, v)),
    removeItem: vi.fn((k: string) => void m.delete(k)),
  });
  const local = store(ls);
  const session = store(new Map());
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("sessionStorage", session);
  vi.stubGlobal("navigator", { onLine: false });
  vi.stubGlobal("window", { localStorage: local, sessionStorage: session, navigator: { onLine: false }, location: { origin: "http://x", pathname: "/", search: "" } });
  vi.stubGlobal("Capacitor", undefined);
  return { ls };
}

const SNAP = {
  products: [{ id: "p1", name: "Huile" }],
  clients: [{ id: "c1", code: "CLT-1", name: "Ali", phone: "0550000000", balance: 0, creditLimit: 0 }],
};

describe("offline pending docs show the 3pack gift", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("gift line: price 0, flagged, and the ticket total excludes it", async () => {
    const { ls } = installFakes();
    const m = await import("@/lib/sync/client");
    ls.set("dili_outbox_v1", JSON.stringify([{
      opId: "op-g1", kind: "ticket", ts: 100, attempts: 0, nextRetryAt: 0,
      payload: { clientId: "c1", paid: 12000, lines: [{ productId: "p1", qty: 10, unitPrice: 1200 }, { productId: "p1", qty: 1, unitPrice: 0, bonusRuleId: "r1" }] },
    }]));
    ls.set("dili_snapshot_v1", JSON.stringify(SNAP));
    const docs = await m.getPendingDocs();
    expect(docs).toHaveLength(1);
    expect(docs[0].total).toBe(12000);
    expect(docs[0].lines).toEqual([
      { productId: "p1", name: "Huile", qty: 10, unitPrice: 1200, lineTotal: 12000 },
      { productId: "p1", name: "Huile", qty: 1, unitPrice: 0, lineTotal: 0, bonus: true },
    ]);
  });
});
