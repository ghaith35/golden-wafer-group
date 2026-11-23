import { describe, it, expect } from "vitest";
import { windowState, dayStart, dayEnd, daysLeft, toYmd } from "@/lib/threepack/window";
import { computeBonus, type ThreePackRuleLite } from "@/lib/threepack/match";

const rule = (w: { startsAt?: string | null; endsAt?: string | null }): ThreePackRuleLite => ({
  id: "r1", name: "10→1", mode: "SINGLE", isActive: true, ...w,
  items: [{ role: "BUY", productId: "p", colis: 10 }, { role: "GIVE", productId: "p", colis: 1 }],
});
const colis = { p: { unitId: "u", factor: 12 } };
const lines = [{ productId: "p", baseQty: 120 }];

describe("promotion window", () => {
  const start = dayStart("2026-11-10")!;
  const end = dayEnd("2026-11-20")!;
  it("is live inside, inclusive of the whole end day", () => {
    expect(windowState({ startsAt: start, endsAt: end }, new Date(2026, 10, 10, 0, 0, 0))).toBe("live");
    expect(windowState({ startsAt: start, endsAt: end }, new Date(2026, 10, 20, 23, 59, 59))).toBe("live");
  });
  it("is scheduled before and expired after", () => {
    expect(windowState({ startsAt: start, endsAt: end }, new Date(2026, 10, 9, 23, 59))).toBe("scheduled");
    expect(windowState({ startsAt: start, endsAt: end }, new Date(2026, 10, 21, 0, 0, 1))).toBe("expired");
  });
  it("open-ended is always live", () => {
    expect(windowState({}, Date.now())).toBe("live");
  });
  it("daysLeft counts calendar days to the end day", () => {
    expect(daysLeft(end, new Date(2026, 10, 20, 9))).toBe(0);
    expect(daysLeft(end, new Date(2026, 10, 17, 9))).toBe(3);
    expect(daysLeft(null)).toBeNull();
  });
  it("round-trips the date input value", () => {
    expect(toYmd(dayStart("2026-03-05"))).toBe("2026-03-05");
  });
});

describe("computeBonus respects the window", () => {
  const w = { startsAt: dayStart("2026-11-10")!.toISOString(), endsAt: dayEnd("2026-11-20")!.toISOString() };
  it("gives inside the window", () => {
    expect(computeBonus([rule(w)], lines, colis, { now: new Date(2026, 10, 15) })).toHaveLength(1);
  });
  it("gives nothing after the end date (even from stale cached rules)", () => {
    expect(computeBonus([rule(w)], lines, colis, { now: new Date(2026, 10, 21) })).toHaveLength(0);
  });
  it("gives nothing before the start date", () => {
    expect(computeBonus([rule(w)], lines, colis, { now: new Date(2026, 10, 9) })).toHaveLength(0);
  });
  it("sync validation (includeInactive) ignores the window", () => {
    expect(computeBonus([rule(w)], lines, colis, { includeInactive: true, now: new Date(2026, 10, 25) })).toHaveLength(1);
  });
});
