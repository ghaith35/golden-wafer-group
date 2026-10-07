import { describe, expect, it } from "vitest";
import { backoffMs } from "@/lib/sync/client";

describe("sync retry backoff — phone keeps data until PC confirms", () => {
  it("first retry waits 60s (30s * 2^1)", () => {
    expect(backoffMs(1)).toBe(60_000);
  });

  it("grows exponentially then caps: 30s, 60s, 120s, 240s, capped 300s", () => {
    expect(backoffMs(0)).toBe(30_000);
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(120_000);
    expect(backoffMs(3)).toBe(240_000);
    expect(backoffMs(4)).toBe(300_000); // 480s capped to 5min
  });

  it("caps at 5 minutes so a stuck phone retries the same day", () => {
    expect(backoffMs(5)).toBe(300_000);
    expect(backoffMs(10)).toBe(300_000);
    expect(backoffMs(100)).toBe(300_000);
  });

  it("ops not yet due must be skipped — only due ops upload (contract)", () => {
    const now = Date.now();
    const outbox = [
      { opId: "a", nextRetryAt: 0 },
      { opId: "b", nextRetryAt: now + 60_000 },
      { opId: "c", nextRetryAt: now - 1000 },
    ];
    const due = outbox.filter((o) => (o.nextRetryAt ?? 0) <= now);
    expect(due.map((o) => o.opId)).toEqual(["a", "c"]);
  });

  it("server-answered-failed ops stay in outbox with error; ok ops are removed; unanswered stay untouched (contract)", () => {
    const due = [{ opId: "ok1" }, { opId: "bad1" }, { opId: "lost1" }];
    const applied = [{ opId: "ok1", ok: true }, { opId: "bad1", ok: false, error: "validation_error" }];
    const okIds = new Set(applied.filter((a) => a.ok).map((a) => a.opId));
    const failed = new Map(applied.filter((a) => !a.ok).map((a) => [a.opId, a.error]));
    const remove: string[] = [];
    const keepFailed: string[] = [];
    const keepUnanswered: string[] = [];
    for (const o of due) {
      if (okIds.has(o.opId)) remove.push(o.opId);
      else if (failed.has(o.opId)) keepFailed.push(o.opId);
      else keepUnanswered.push(o.opId);
    }
    expect(remove).toEqual(["ok1"]);
    expect(keepFailed).toEqual(["bad1"]);
    expect(keepUnanswered).toEqual(["lost1"]);
  });
});
