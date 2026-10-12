import { beforeEach, describe, expect, it, vi } from "vitest";

// Pending offline docs (queued tickets/orders) must resolve to visible,
// openable view-models with zero connection — covered here at the unit
// level; the full phone path is covered by tests/e2e/offline-pending-docs.

function installFakes(online = true) {
  const ls = new Map<string, string>();
  const ss = new Map<string, string>();
  const local = {
    getItem: vi.fn((k: string) => (ls.has(k) ? ls.get(k)! : null)),
    setItem: vi.fn((k: string, v: string) => void ls.set(k, v)),
    removeItem: vi.fn((k: string) => void ls.delete(k)),
  };
  const session = {
    getItem: vi.fn((k: string) => (ss.has(k) ? ss.get(k)! : null)),
    setItem: vi.fn((k: string, v: string) => void ss.set(k, v)),
    removeItem: vi.fn((k: string) => void ss.delete(k)),
  };
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("sessionStorage", session);
  vi.stubGlobal("navigator", { onLine: online });
  vi.stubGlobal("window", {
    localStorage: local,
    sessionStorage: session,
    navigator: { onLine: online },
    location: { origin: "http://x", pathname: "/", search: "" },
  });
  vi.stubGlobal("Capacitor", undefined);
  return { ls, ss };
}

const SNAP = {
  products: [{ id: "p1", name: "Huile" }],
  clients: [{ id: "c1", code: "CLT-1", name: "Ali", phone: "0550000000", balance: 0, creditLimit: 0 }],
};

describe("getPendingDocs", () => {
  beforeEach(async () => {
    vi.resetModules();
    installFakes();
  });

  it("ticket resolves names + total from the snapshot", async () => {
    const { ls } = installFakes();
    const m = await import("@/lib/sync/client");
    ls.set("dili_outbox_v1", JSON.stringify([{
      opId: "op-t1", kind: "ticket", ts: 100, attempts: 0, nextRetryAt: 0,
      payload: { clientId: "c1", paid: 50, lines: [{ productId: "p1", qty: 2, unitPrice: 150 }] },
    }]));
    ls.set("dili_snapshot_v1", JSON.stringify(SNAP));
    const docs = await m.getPendingDocs();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      opId: "op-t1", kind: "ticket", clientName: "Ali", clientCode: "CLT-1",
      clientPhone: "0550000000", paid: 50, total: 300,
    });
    expect(docs[0].lines).toEqual([{ productId: "p1", name: "Huile", qty: 2, unitPrice: 150, lineTotal: 300 }]);
  });

  it("order has null total; pending: client resolves from outbox", async () => {
    const { ls } = installFakes();
    const m = await import("@/lib/sync/client");
    ls.set("dili_outbox_v1", JSON.stringify([
      {
        opId: "op-c9", kind: "client", ts: 90, attempts: 0, nextRetryAt: 0,
        payload: { code: "CLT-9", name: "Sara", phone: null, tierId: null },
      },
      {
        opId: "op-o1", kind: "order", ts: 95, attempts: 0, nextRetryAt: 0,
        payload: { clientId: "pending:op-c9", paid: 0, lines: [{ productId: "p1", qty: 3 }] },
      },
    ]));
    ls.set("dili_snapshot_v1", JSON.stringify(SNAP));
    const docs = await m.getPendingDocs();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ kind: "order", total: null, clientName: "Sara", clientCode: "CLT-9" });
    expect(docs[0].lines[0]).toMatchObject({ name: "Huile", qty: 3, unitPrice: 0 });
  });

  it("unknown product never throws, sorts newest first, ignores other kinds", async () => {
    const { ls } = installFakes();
    const m = await import("@/lib/sync/client");
    ls.set("dili_outbox_v1", JSON.stringify([
      { opId: "op-x", kind: "expense", ts: 300, attempts: 0, nextRetryAt: 0, payload: {} },
      { opId: "op-t2", kind: "ticket", ts: 200, attempts: 0, nextRetryAt: 0, payload: { clientId: null, paid: 0, lines: [{ productId: "zz", qty: 1, unitPrice: 10 }] } },
      { opId: "op-t3", kind: "ticket", ts: 100, attempts: 0, nextRetryAt: 0, payload: { clientId: null, paid: 0, lines: [] } },
    ]));
    const docs = await m.getPendingDocs();
    expect(docs.map((d) => d.opId)).toEqual(["op-t2", "op-t3"]);
    expect(docs[0].lines[0].name).toBe("…");
  });

  it("empty/corrupt outbox → []", async () => {
    const { ls } = installFakes();
    const m = await import("@/lib/sync/client");
    expect(await m.getPendingDocs()).toEqual([]);
    ls.set("dili_outbox_v1", "garbage{{{");
    expect(await m.getPendingDocs()).toEqual([]);
  });
});

describe("saleErrText", () => {
  beforeEach(() => {
    vi.resetModules();
    installFakes();
  });

  it("maps every guard key, passes unknowns through", async () => {
    const m = await import("@/lib/sync/client");
    const labels = {
      errRemise: "R", errQr: "Q", errStock: "S", errCashOnly: "C", errDebtOff: "D",
      errClientReq: "CR", errCreditLimit: "CL", errOverpaid: "O", errSaveFailed: "SF",
    };
    expect(m.saleErrText(labels, "insufficient_stock")).toBe("S");
    expect(m.saleErrText(labels, "qr_required")).toBe("Q");
    expect(m.saleErrText(labels, "credit_limit_exceeded")).toBe("CL");
    expect(m.saleErrText(labels, "save_failed")).toBe("SF");
    expect(m.saleErrText(labels, "something_else")).toBe("something_else");
    expect(m.saleErrText(labels, null)).toBeNull();
    expect(m.saleErrText({}, "insufficient_stock")).toBe("insufficient_stock");
  });
});

describe("shouldAutoSync (30s heartbeat gate)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("syncs only when visible + online + idle + paired + work waiting", async () => {
    const m = await import("@/lib/sync/client");
    const base = { hidden: false, online: true, busy: false, hasToken: true, pending: 3 };
    expect(m.shouldAutoSync(base)).toBe(true);
    expect(m.AUTO_SYNC_MS).toBe(30_000);
    expect(m.shouldAutoSync({ ...base, hidden: true })).toBe(false);
    expect(m.shouldAutoSync({ ...base, online: false })).toBe(false);
    expect(m.shouldAutoSync({ ...base, busy: true })).toBe(false);
    expect(m.shouldAutoSync({ ...base, hasToken: false })).toBe(false);
    expect(m.shouldAutoSync({ ...base, pending: 0 })).toBe(false);
  });
});

describe("serverUnreachable", () => {  beforeEach(() => {
    vi.resetModules();
  });

  it("phone offline → unreachable; fresh down → unreachable; else reachable", async () => {
    installFakes(false);
    let m = await import("@/lib/sync/client");
    expect(m.serverUnreachable()).toBe(true);

    vi.resetModules();
    const f = installFakes(true);
    m = await import("@/lib/sync/client");
    expect(m.serverUnreachable()).toBe(false); // unknown → assume up
    f.ss.set("dili_server_reach_v1", JSON.stringify({ ok: false, ts: Date.now() }));
    expect(m.serverUnreachable()).toBe(true);
    f.ss.set("dili_server_reach_v1", JSON.stringify({ ok: true, ts: Date.now() }));
    expect(m.serverUnreachable()).toBe(false);
    f.ss.set("dili_server_reach_v1", JSON.stringify({ ok: false, ts: Date.now() - 60000 }));
    expect(m.serverUnreachable()).toBe(false); // stale → assume up
  });
});
