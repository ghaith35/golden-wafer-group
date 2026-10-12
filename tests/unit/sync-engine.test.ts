import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Sync engine: idempotency + auth — the client-delivery safety net ───
// Phone retries the same opId after timeout / double-tap / app kill.
// PC must apply once, second time is a no-op (no duplicate ticket/client/cash).

vi.mock("@/lib/db", () => ({
  prisma: {
    syncOp: { findUnique: vi.fn(), create: vi.fn() },
    device: { findFirst: vi.fn(), update: vi.fn() },
    store: { findFirst: vi.fn(), findMany: vi.fn(async () => []) },
    product: { findMany: vi.fn(async () => []) },
    unit: { findMany: vi.fn(async () => []) },
    priceTier: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    productCategory: { findMany: vi.fn(async () => []) },
    secteur: { findMany: vi.fn(async () => []) },
    wilaya: { findMany: vi.fn(async () => []) },
    customer: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null), update: vi.fn(async (a: any) => ({ id: a?.where?.id ?? "c1" })) },
    supplier: { findFirst: vi.fn(async () => null) },
    sale: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    versement: { findFirst: vi.fn(async () => null) },
    clientReturn: { findFirst: vi.fn(async () => null) },
    transfer: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    expense: { create: vi.fn(), findFirst: vi.fn(async () => null), update: vi.fn(async (a: any) => ({ id: a?.where?.id ?? "exp1" })) },
    stockBatch: { groupBy: vi.fn(async () => []) },
    tournee: { findMany: vi.fn(async () => []) },
    company: { findUnique: vi.fn(async () => null) },
    user: { findFirst: vi.fn(async () => ({ role: "Livreur" })) },
  },
}));
vi.mock("@/lib/settings/helpers", () => ({ getOrCreateSettings: vi.fn() }));
vi.mock("@/lib/sales/service", () => ({
  createTicket: vi.fn(),
  createOrder: vi.fn(),
  createClientReturn: vi.fn(),
  deliverOrder: vi.fn(),
  cancelSale: vi.fn(),
  reopenOrder: vi.fn(),
}));
vi.mock("@/lib/inventory/service", () => ({
  declareTransfer: vi.fn(),
  resolveTransfer: vi.fn(),
}));
vi.mock("@/lib/holds", () => ({ vanHolds: vi.fn(async () => ({ holds: [] })) }));
vi.mock("@/lib/docs/sequences", () => ({ ensureSeasonFor: vi.fn() }));

import { prisma } from "@/lib/db";
import { getOrCreateSettings } from "@/lib/settings/helpers";
import { ensureSeasonFor } from "@/lib/docs/sequences";
import { createTicket, deliverOrder, cancelSale } from "@/lib/sales/service";
import { handleSync } from "@/lib/sync/engine";

const TOKEN = "phone-token-12345678";

function mockDevice(over: Record<string, unknown> = {}) {
  (prisma.device.findFirst as any).mockResolvedValue({
    id: "dev1",
    companyId: "co1",
    locationId: "van1",
    userId: "user1",
    ...over,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDevice();
  (prisma.user.findFirst as any).mockResolvedValue({ role: "Livreur" });
  (getOrCreateSettings as any).mockResolvedValue({ vanBindingMode: "LOCKED" });
  (prisma.syncOp.findUnique as any).mockResolvedValue(null);
  (prisma.syncOp.create as any).mockImplementation(async (a: any) => a.data);
  (prisma.device.update as any).mockResolvedValue({});
  (createTicket as any).mockResolvedValue({ id: "sale-new" });
});

describe("handleSync — phone with new data", () => {
  it("applies a ticket op and records APPLIED", async () => {
    const res = await handleSync({
      deviceToken: TOKEN,
      ops: [{ opId: "op-ticket-0001", kind: "ticket", payload: { lines: [] } }],
    } as any);
    expect(res.applied).toHaveLength(1);
    expect(res.applied[0]).toMatchObject({ opId: "op-ticket-0001", ok: true, id: "sale-new" });
    expect(createTicket).toHaveBeenCalledTimes(1);
    expect(prisma.syncOp.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ opId: "op-ticket-0001", status: "APPLIED" }) })
    );
  });

  it("CRITICAL: same opId sent twice creates ONE sale (retry after timeout)", async () => {
    const op = { opId: "op-retry-0001", kind: "ticket", payload: { lines: [] } };
    // First attempt: not seen → applied.
    await handleSync({ deviceToken: TOKEN, ops: [op] } as any);
    expect(createTicket).toHaveBeenCalledTimes(1);

    // Second attempt (phone retried because it never got the answer):
    // server already has APPLIED row → must NOT call createTicket again.
    (prisma.syncOp.findUnique as any).mockResolvedValue({ status: "APPLIED", error: null });
    (createTicket as any).mockClear();
    const res2 = await handleSync({ deviceToken: TOKEN, ops: [op] } as any);
    expect(res2.applied[0]).toMatchObject({ opId: "op-retry-0001", ok: true });
    expect(createTicket).not.toHaveBeenCalled();
  });

  it("CRITICAL: replay of a FAILED op returns the stored error without re-executing", async () => {
    (prisma.syncOp.findUnique as any).mockResolvedValue({ status: "FAILED", error: "validation_error" });
    const res = await handleSync({
      deviceToken: TOKEN,
      ops: [{ opId: "op-bad-0001", kind: "ticket", payload: {} }],
    } as any);
    expect(res.applied[0]).toMatchObject({ opId: "op-bad-0001", ok: false, error: "validation_error" });
    expect(createTicket).not.toHaveBeenCalled();
  });

  it("Vendeur (mandob) ticket op is rejected with forbidden — no sale replay", async () => {
    (prisma.user.findFirst as any).mockResolvedValue({ role: "Vendeur" });
    const res = await handleSync({
      deviceToken: TOKEN,
      ops: [{ opId: "op-vendeur-0001", kind: "ticket", payload: { lines: [] } }],
    } as any);
    expect(res.applied[0]).toMatchObject({ opId: "op-vendeur-0001", ok: false, error: "forbidden" });
    expect(createTicket).not.toHaveBeenCalled();
  });

  it("Vendeur sale-cancel op is rejected with forbidden", async () => {
    (prisma.user.findFirst as any).mockResolvedValue({ role: "Vendeur" });
    const res = await handleSync({
      deviceToken: TOKEN,
      ops: [{ opId: "op-vendeur-0002", kind: "sale-cancel", payload: { saleId: "s1" } }],
    } as any);
    expect(res.applied[0]).toMatchObject({ opId: "op-vendeur-0002", ok: false, error: "forbidden" });
    expect(cancelSale).not.toHaveBeenCalled();
  });

  it("expense op creates a van-linked expense once (retry is a no-op)", async () => {
    (ensureSeasonFor as any).mockResolvedValue({ id: "season1" });
    (prisma.store.findFirst as any).mockResolvedValue({ id: "van1" });
    (prisma.expense.create as any).mockResolvedValue({ id: "exp1" });
    const op = { opId: "op-expense-0001", kind: "expense", payload: { label: "fuel", amount: 2000 } };
    const res = await handleSync({ deviceToken: TOKEN, ops: [op] } as any);
    expect(res.applied[0]).toMatchObject({ opId: "op-expense-0001", ok: true, id: "exp1" });
    expect(prisma.expense.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ label: "fuel", amount: 2000, locationId: "van1", opId: "op-expense-0001" }),
      })
    );
    // Retry with the same opId → served from the APPLIED row, no second row.
    (prisma.syncOp.findUnique as any).mockResolvedValue({ status: "APPLIED", error: null, resultId: "exp1" });
    (prisma.expense.create as any).mockClear();
    const res2 = await handleSync({ deviceToken: TOKEN, ops: [op] } as any);
    expect(res2.applied[0]).toMatchObject({ opId: "op-expense-0001", ok: true });
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  it("expense-update edits the van's own row (Vendeur allowed — expenses are not restricted)", async () => {
    (prisma.user.findFirst as any).mockResolvedValue({ role: "Vendeur" });
    (prisma.store.findFirst as any).mockResolvedValue({ id: "van1" });
    (prisma.expense.findFirst as any).mockResolvedValue({ id: "exp1", locationId: "van1", deletedAt: null });
    const res = await handleSync({
      deviceToken: TOKEN,
      ops: [{ opId: "op-expupd-0001", kind: "expense-update", payload: { ref: "exp1", label: "fuel+", amount: 2500 } }],
    } as any);
    expect(res.applied[0]).toMatchObject({ opId: "op-expupd-0001", ok: true, id: "exp1" });
    expect(prisma.expense.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "exp1" }, data: expect.objectContaining({ label: "fuel+", amount: 2500 }) })
    );
  });

  it("expense-update on another van's row is forbidden", async () => {
    (prisma.store.findFirst as any).mockResolvedValue({ id: "van1" });
    (prisma.expense.findFirst as any).mockResolvedValue({ id: "exp9", locationId: "vanOTHER", deletedAt: null });
    const res = await handleSync({
      deviceToken: TOKEN,
      ops: [{ opId: "op-expupd-0002", kind: "expense-update", payload: { ref: "exp9", label: "x" } }],
    } as any);
    expect(res.applied[0]).toMatchObject({ opId: "op-expupd-0002", ok: false, error: "forbidden" });
  });

  it("expense-delete soft-deletes the van's own row", async () => {
    (prisma.store.findFirst as any).mockResolvedValue({ id: "van1" });
    (prisma.expense.findFirst as any).mockResolvedValue({ id: "exp1", locationId: "van1", deletedAt: null });
    const res = await handleSync({
      deviceToken: TOKEN,
      ops: [{ opId: "op-expdel-0001", kind: "expense-delete", payload: { ref: "exp1" } }],
    } as any);
    expect(res.applied[0]).toMatchObject({ opId: "op-expdel-0001", ok: true, id: "exp1" });
    expect(prisma.expense.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "exp1" }, data: expect.objectContaining({ deletedAt: expect.any(Date) }) })
    );
  });

  it("order-deliver applies the delivery once (retry is a no-op)", async () => {
    const { deliverOrder } = await import("@/lib/sales/service");
    (prisma.sale.findFirst as any).mockImplementation(async (a: any) => {
      if (a?.where?.sourceId) return { id: "deliv1" };
      return { id: "ord1", status: "CONFIRMED", kind: "ORDER" };
    });
    (deliverOrder as any).mockResolvedValue({ id: "deliv1" });
    const op = { opId: "op-deliver-0001", kind: "order-deliver", payload: { saleId: "ord1", locationId: "van1", paid: 100 } };
    const res = await handleSync({ deviceToken: TOKEN, ops: [op] } as any);
    expect(res.applied[0]).toMatchObject({ opId: "op-deliver-0001", ok: true, id: "deliv1" });
    expect(deliverOrder).toHaveBeenCalledTimes(1);
    (prisma.syncOp.findUnique as any).mockResolvedValue({ status: "APPLIED", error: null, resultId: "deliv1" });
    (deliverOrder as any).mockClear();
    const res2 = await handleSync({ deviceToken: TOKEN, ops: [op] } as any);
    expect(res2.applied[0]).toMatchObject({ opId: "op-deliver-0001", ok: true });
    expect(deliverOrder).not.toHaveBeenCalled();
  });

  it("sale-cancel reverses once; already-cancelled is success", async () => {
    const { cancelSale } = await import("@/lib/sales/service");
    (prisma.sale.findFirst as any).mockResolvedValue({ id: "s1", status: "DELIVERED" });
    (cancelSale as any).mockResolvedValue({ ok: true });
    const op = { opId: "op-cancel-0001", kind: "sale-cancel", payload: { saleId: "s1" } };
    const res = await handleSync({ deviceToken: TOKEN, ops: [op] } as any);
    expect(res.applied[0]).toMatchObject({ opId: "op-cancel-0001", ok: true });
    expect(cancelSale).toHaveBeenCalledTimes(1);
    (prisma.sale.findFirst as any).mockResolvedValue({ id: "s1", status: "CANCELLED" });
    (cancelSale as any).mockClear();
    const res2 = await handleSync({ deviceToken: TOKEN, ops: [{ opId: "op-cancel-0002", kind: "sale-cancel", payload: { saleId: "s1" } }] } as any);
    expect(res2.applied[0]).toMatchObject({ opId: "op-cancel-0002", ok: true });
    expect(cancelSale).not.toHaveBeenCalled();
  });

  it("sale-reopen calls reopenOrder once for DELIVERED, skips when already open", async () => {
    const { reopenOrder } = await import("@/lib/sales/service");
    (prisma.sale.findFirst as any).mockResolvedValue({ id: "s9", status: "DELIVERED", kind: "ORDER" });
    (reopenOrder as any).mockResolvedValue({ ok: true });
    const op = { opId: "op-reopen-0001", kind: "sale-reopen", payload: { saleId: "s9" } };
    const res = await handleSync({ deviceToken: TOKEN, ops: [op] } as any);
    expect(res.applied[0]).toMatchObject({ opId: "op-reopen-0001", ok: true });
    expect(reopenOrder).toHaveBeenCalledTimes(1);
    (prisma.sale.findFirst as any).mockResolvedValue({ id: "s9", status: "CONFIRMED", kind: "ORDER" });
    (reopenOrder as any).mockClear();
    const res2 = await handleSync({
      deviceToken: TOKEN,
      ops: [{ opId: "op-reopen-0002", kind: "sale-reopen", payload: { saleId: "s9" } }],
    } as any);
    expect(res2.applied[0]).toMatchObject({ opId: "op-reopen-0002", ok: true });
    expect(reopenOrder).not.toHaveBeenCalled();
  });

  it("ticket for a pending (offline-created) client resolves via earlier sync", async () => {
    // Client op applied in a PREVIOUS sync: lookup by opId finds the row.
    (prisma.customer.findFirst as any).mockResolvedValue({ id: "cust-real" });
    (createTicket as any).mockResolvedValue({ id: "sale-pend" });
    const op = { opId: "op-tpend-0001", kind: "ticket", payload: { clientId: "pending:op-cli-0001", lines: [] } };
    const res = await handleSync({ deviceToken: TOKEN, ops: [op] } as any);
    expect(res.applied[0]).toMatchObject({ opId: "op-tpend-0001", ok: true });
    expect(createTicket).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ clientId: "cust-real" }),
      expect.anything(),
    );
  });

  it("ticket for an unknown pending client fails visibly (bad_client)", async () => {
    (prisma.customer.findFirst as any).mockResolvedValue(null);
    const op = { opId: "op-tpend-0002", kind: "ticket", payload: { clientId: "pending:op-missing", lines: [] } };
    const res = await handleSync({ deviceToken: TOKEN, ops: [op] } as any);
    expect(res.applied[0]).toMatchObject({ opId: "op-tpend-0002", ok: false, error: "bad_client" });
  });

  it("transfer-reject refuses holdings back like online", async () => {
    const { resolveTransfer } = await import("@/lib/inventory/service");
    (resolveTransfer as any).mockResolvedValue({ id: "tr1" });
    const op = { opId: "op-trej-0001", kind: "transfer-reject", payload: { transferId: "tr1", action: "reject" } };
    const res = await handleSync({ deviceToken: TOKEN, ops: [op] } as any);
    expect(res.applied[0]).toMatchObject({ opId: "op-trej-0001", ok: true, id: "tr1" });
    expect(resolveTransfer).toHaveBeenCalledWith(expect.anything(), expect.anything(), "tr1", { action: "reject" });
  });

  it("unknown kind is recorded FAILED (phone keeps it in outbox with error, PC data untouched)", async () => {
    const res = await handleSync({
      deviceToken: TOKEN,
      ops: [{ opId: "op-weird-0001", kind: "nope", payload: {} }],
    } as any);
    expect(res.applied[0].ok).toBe(false);
    expect(prisma.syncOp.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) })
    );
  });

  it("revoked/unknown device token → 401, nothing applied", async () => {
    (prisma.device.findFirst as any).mockResolvedValue(null);
    await expect(handleSync({ deviceToken: TOKEN, ops: [] } as any)).rejects.toThrow("bad_device");
  });

  it("deactivated driver → 401 user_inactive (phone must wipe offline credential)", async () => {
    mockDevice({ user: { isActive: false } });
    await expect(handleSync({ deviceToken: TOKEN, ops: [] } as any)).rejects.toThrow("user_inactive");
  });

  it("LOCKED device without van → device_unbound (admin must bind first)", async () => {
    mockDevice({ locationId: null });
    await expect(handleSync({ deviceToken: TOKEN, ops: [] } as any)).rejects.toThrow("device_unbound");
  });

  it("device without user → device_no_user (no orphan sales)", async () => {
    mockDevice({ userId: null });
    await expect(handleSync({ deviceToken: TOKEN, ops: [] } as any)).rejects.toThrow("device_no_user");
  });

  it("failed service call (e.g. bad client) → ok:false + FAILED row, sync still returns pull", async () => {
    (createTicket as any).mockRejectedValue(new Error("validation_error"));
    const res = await handleSync({
      deviceToken: TOKEN,
      ops: [{ opId: "op-fail-0001", kind: "ticket", payload: {} }],
    } as any);
    expect(res.applied[0]).toMatchObject({ opId: "op-fail-0001", ok: false, error: "validation_error" });
    expect(res.pulled).toBeDefined();
    expect(res.serverTime).toBeDefined();
  });

  it("CRITICAL: concurrent duplicate (entity opId unique) → applied once, not FAILED", async () => {
    // A racing sync already created the sale; our create collides on opId.
    (createTicket as any).mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    (prisma.sale.findFirst as any).mockResolvedValue({ id: "sale-existing" });
    const res = await handleSync({
      deviceToken: TOKEN,
      ops: [{ opId: "op-race-0001", kind: "ticket", payload: {} }],
    } as any);
    expect(res.applied[0]).toMatchObject({ opId: "op-race-0001", ok: true, id: "sale-existing" });
    expect(prisma.syncOp.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "APPLIED", resultId: "sale-existing" }) })
    );
  });

  it("versement for a client of another company is rejected (tenant isolation)", async () => {
    (prisma.customer.findFirst as any).mockResolvedValue(null);
    const res = await handleSync({
      deviceToken: TOKEN,
      ops: [{ opId: "op-pay-0001", kind: "versement", payload: { clientId: "foreign", amount: 1000 } }],
    } as any);
    expect(res.applied[0]).toMatchObject({ opId: "op-pay-0001", ok: false, error: "bad_client", permanent: true });
  });

  it("client-update applies driver-safe fields, drops financial ones", async () => {
    (prisma.customer.findFirst as any).mockResolvedValue({ id: "c1" });
    const res = await handleSync({
      deviceToken: TOKEN,
      ops: [{
        opId: "op-cu-0001",
        kind: "client-update",
        payload: {
          clientId: "c1",
          patch: { name: "New Name", phone: "0550000001", address: "Alger", tierId: "gold", creditLimit: 99999, balance: 5, code: "X" },
        },
      }],
    } as any);
    expect(res.applied[0]).toMatchObject({ opId: "op-cu-0001", ok: true, id: "c1" });
    const data = (prisma.customer.update as any).mock.calls[0][0].data;
    expect(data).toMatchObject({ name: "New Name", phone: "0550000001", address: "Alger" });
    expect(data).not.toHaveProperty("tierId");
    expect(data).not.toHaveProperty("creditLimit");
    expect(data).not.toHaveProperty("balance");
    expect(data).not.toHaveProperty("code");
  });

  it("client-update resolves a pending: client id synced in an earlier batch", async () => {
    (prisma.customer.findFirst as any).mockImplementation(async (a: any) => {
      if (a?.where?.opId === "op-c-early") return { id: "c9" };
      if (a?.where?.id === "c9") return { id: "c9" };
      return null;
    });
    const res = await handleSync({
      deviceToken: TOKEN,
      ops: [{ opId: "op-cu-0002", kind: "client-update", payload: { clientId: "pending:op-c-early", patch: { name: "Renamed" } } }],
    } as any);
    expect(res.applied[0]).toMatchObject({ opId: "op-cu-0002", ok: true, id: "c9" });
    expect((prisma.customer.update as any).mock.calls[0][0].where).toMatchObject({ id: "c9" });
  });

  it("client-update on a taken phone FAILS permanent duplicate_phone (never silent)", async () => {
    (prisma.customer.findFirst as any).mockResolvedValue({ id: "c1" });
    (prisma.customer.update as any).mockRejectedValueOnce(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    const res = await handleSync({
      deviceToken: TOKEN,
      ops: [{ opId: "op-cu-0003", kind: "client-update", payload: { clientId: "c1", patch: { phone: "0550000002" } } }],
    } as any);
    expect(res.applied[0]).toMatchObject({ opId: "op-cu-0003", ok: false, error: "duplicate_phone", permanent: true });
  });

  it("client-update on unknown client fails bad_client", async () => {
    (prisma.customer.findFirst as any).mockResolvedValue(null);
    const res = await handleSync({
      deviceToken: TOKEN,
      ops: [{ opId: "op-cu-0004", kind: "client-update", payload: { clientId: "ghost", patch: { name: "X" } } }],
    } as any);
    expect(res.applied[0]).toMatchObject({ opId: "op-cu-0004", ok: false, error: "bad_client" });
  });

  it("Vendeur transfer-declare is forbidden (restock is livreur-only)", async () => {
    (prisma.user.findFirst as any).mockResolvedValue({ role: "Vendeur" });
    const { declareTransfer } = await import("@/lib/inventory/service");
    const res = await handleSync({
      deviceToken: TOKEN,
      ops: [{ opId: "op-td-0001", kind: "transfer-declare", payload: { fromLocationId: "depot1", toLocationId: "van1", lines: [{ productId: "p1", qty: 5 }] } }],
    } as any);
    expect(res.applied[0]).toMatchObject({ opId: "op-td-0001", ok: false, error: "forbidden" });
    expect(declareTransfer).not.toHaveBeenCalled();
  });

  it("Livreur transfer-declare passes to the service with the opId", async () => {
    (prisma.user.findFirst as any).mockResolvedValue({ role: "Livreur" });
    const { declareTransfer } = await import("@/lib/inventory/service");
    (declareTransfer as any).mockResolvedValue({ id: "tr1" });
    const res = await handleSync({
      deviceToken: TOKEN,
      ops: [{ opId: "op-td-0002", kind: "transfer-declare", payload: { fromLocationId: "depot1", toLocationId: "van1", lines: [{ productId: "p1", qty: 5 }] } }],
    } as any);
    expect(res.applied[0]).toMatchObject({ opId: "op-td-0002", ok: true, id: "tr1" });
    expect(declareTransfer).toHaveBeenCalled();
  });
});
