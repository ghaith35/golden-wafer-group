import { describe, it, expect } from "vitest";
import { isPlanDue, dueKeys, nextDueKey, weekdayOfKey, withSkip, parseSkips } from "@/lib/tournees/plans-pure";

// 2026-11-23 is a Monday.
const weekly = { weekday: 1, intervalWeeks: 1, anchorKey: "2026-11-23" };
const biweekly = { weekday: 1, intervalWeeks: 2, anchorKey: "2026-11-23" };

describe("recurring tour calendar", () => {
  it("knows the weekday of a key", () => {
    expect(weekdayOfKey("2026-11-23")).toBe(1);
    expect(weekdayOfKey("2026-11-29")).toBe(0);
  });
  it("weekly: due every Monday from the anchor on, never before", () => {
    expect(isPlanDue(weekly, "2026-11-23")).toBe(true);
    expect(isPlanDue(weekly, "2026-11-30")).toBe(true);
    expect(isPlanDue(weekly, "2026-12-07")).toBe(true);
    expect(isPlanDue(weekly, "2026-11-16")).toBe(false); // before the anchor
    expect(isPlanDue(weekly, "2026-11-24")).toBe(false); // Tuesday
  });
  it("is endless: due a year and five years later", () => {
    expect(isPlanDue(weekly, "2027-11-22")).toBe(true);
    expect(isPlanDue(weekly, "2031-11-24")).toBe(true);
  });
  it("biweekly: anchor week, then every 2 weeks", () => {
    expect(isPlanDue(biweekly, "2026-11-23")).toBe(true);
    expect(isPlanDue(biweekly, "2026-11-30")).toBe(false);
    expect(isPlanDue(biweekly, "2026-12-07")).toBe(true);
    expect(isPlanDue(biweekly, "2026-12-14")).toBe(false);
    expect(isPlanDue(biweekly, "2026-12-21")).toBe(true);
    expect(isPlanDue(biweekly, "2027-11-22")).toBe(true); // 52 weeks later = even
    expect(isPlanDue(biweekly, "2027-11-29")).toBe(false); // 53 weeks later = odd
  });
  it("biweekly parity holds across the year boundary", () => {
    // 2026-11-23 + 6 weeks = 2027-01-04 (due), +7 weeks = 2027-01-11 (not)
    expect(isPlanDue(biweekly, "2027-01-04")).toBe(true);
    expect(isPlanDue(biweekly, "2027-01-11")).toBe(false);
  });
  it("two biweekly plans on opposite weeks never share a Monday", () => {
    const other = { weekday: 1, intervalWeeks: 2, anchorKey: "2026-11-30" };
    const all = dueKeys(biweekly, "2026-11-23", "2027-03-01");
    const all2 = dueKeys(other, "2026-11-23", "2027-03-01");
    expect(all.filter((k) => all2.includes(k))).toHaveLength(0);
    expect(all.length + all2.length).toBe(dueKeys(weekly, "2026-11-23", "2027-03-01").length);
  });
  it("dueKeys lists a window in order and respects the anchor", () => {
    expect(dueKeys(biweekly, "2026-11-01", "2026-12-31")).toEqual(["2026-11-23", "2026-12-07", "2026-12-21"]);
    expect(dueKeys(weekly, "2026-11-24", "2026-12-08")).toEqual(["2026-11-30", "2026-12-07"]);
    expect(dueKeys(weekly, "2026-12-08", "2026-11-24")).toEqual([]);
  });
  it("removed single dates are skipped, the rest continue", () => {
    const p = { ...weekly, skips: withSkip("", "2026-11-30") };
    expect(isPlanDue(p, "2026-11-30")).toBe(false);
    expect(isPlanDue(p, "2026-12-07")).toBe(true);
    expect(parseSkips(withSkip(withSkip("", "2026-12-07"), "2026-11-30"))).toEqual(new Set(["2026-11-30", "2026-12-07"]));
  });
  it("nextDueKey finds the next occurrence", () => {
    expect(nextDueKey(biweekly, "2026-11-24")).toBe("2026-12-07");
    expect(nextDueKey(weekly, "2026-11-23")).toBe("2026-11-23");
  });
});
