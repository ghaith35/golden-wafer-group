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
    customer: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    supplier: { findFirst: vi.fn(async () => null) },
    sale: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    versement: { findFirst: vi.fn(async () => null) },
    clientReturn: { findFirst: vi.fn(async () => null) },
    transfer: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    stockBatch: { groupBy: vi.fn(async () => []) },
    tournee: { findMany: vi.fn(async () => []) },
    company: { findUnique: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/settings/helpers", () => ({ getOrCreateSettings: vi.fn() }));
vi.mock("@/lib/sales/service", () => ({
  createTicket: vi.fn(),
  createOrder: vi.fn(),
  createClientReturn: vi.fn(),
}));
vi.mock("@/lib/holds", () => ({ vanHolds: vi.fn(async () => ({ holds: [] })) }));
vi.mock("@/lib/docs/sequences", () => ({ ensureSeasonFor: vi.fn() }));

import { prisma } from "@/lib/db";
import { getOrCreateSettings } from "@/lib/settings/helpers";
import { createTicket } from "@/lib/sales/service";
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
});
