import { describe, expect, it } from "vitest";
import { nextDocNumber } from "@/lib/docs/sequences";

function fakeTx(seq: { nextNo: number } | null) {
  return {
    // Advisory lock (Postgres path) — no-op in the unit test.
    $queryRaw: async () => [],
    documentSequence: {
      findFirst: async () => seq,
      update: async () => ({ ...seq, nextNo: (seq?.nextNo ?? 1) + 1 }),
      create: async (a: any) => a.data,
    },
  } as any;
}

describe("nextDocNumber — no duplicate numbers PC vs synced phone clients", () => {
  it("first client code is CLT-0001", async () => {
    const code = await nextDocNumber(fakeTx(null), "co1", "client", 0, "CLT");
    expect(code).toBe("CLT-0001");
  });

  it("increments from existing sequence", async () => {
    const code = await nextDocNumber(fakeTx({ nextNo: 41 }), "co1", "client", 0, "CLT");
    expect(code).toBe("CLT-0041");
  });

  it("yearly docs use YEAR-0000 format", async () => {
    const code = await nextDocNumber(fakeTx(null), "co1", "sale", 2026);
    expect(code).toBe("2026-0001");
  });
});
