import { describe, expect, it } from "vitest";
import { syncOpSchema, syncSchema } from "@/lib/sync/validation";

const baseOp = (over: Record<string, unknown> = {}) => ({
  opId: "abc12345-xyz",
  kind: "ticket",
  payload: { clientId: "c1", lines: [] },
  ...over,
});

describe("sync validation — phone → PC contract", () => {
  it("accepts every supported op kind", () => {
    const kinds = [
      "ticket",
      "order",
      "client",
      "versement",
      "client-return",
      "transfer-declare",
      "transfer-confirm",
      "stop-update",
      "cash-declare",
      "day-start",
      "day-finish",
    ] as const;
    for (const kind of kinds) {
      const r = syncOpSchema.safeParse(baseOp({ opId: `op-${kind}-12345`, kind }));
      expect(r.success, kind).toBe(true);
    }
  });

  it("rejects unknown kind (typo on phone must fail fast, not corrupt PC)", () => {
    const r = syncOpSchema.safeParse(baseOp({ kind: "tikcet" }));
    expect(r.success).toBe(false);
  });

  it("rejects short opId (dedupe key must be stable)", () => {
    const r = syncOpSchema.safeParse(baseOp({ opId: "short" }));
    expect(r.success).toBe(false);
  });

  it("rejects empty sync body without deviceToken", () => {
    const r = syncSchema.safeParse({ ops: [] });
    expect(r.success).toBe(false);
  });

  it("accepts pull-only sync (no ops, just catalog refresh)", () => {
    const r = syncSchema.safeParse({ deviceToken: "a-very-long-token-123" });
    expect(r.success).toBe(true);
  });

  it("rejects >200 ops in one sync (phone must chunk its backlog)", () => {
    const ops = Array.from({ length: 201 }, (_, i) =>
      baseOp({ opId: `op-${String(i).padStart(4, "0")}-xyz` })
    );
    const r = syncSchema.safeParse({ deviceToken: "a-very-long-token-123", ops });
    expect(r.success).toBe(false);
  });

  it("accepts exactly 200 ops", () => {
    const ops = Array.from({ length: 200 }, (_, i) =>
      baseOp({ opId: `op-${String(i).padStart(4, "0")}-xyz` })
    );
    const r = syncSchema.safeParse({ deviceToken: "a-very-long-token-123", ops });
    expect(r.success).toBe(true);
  });
});
