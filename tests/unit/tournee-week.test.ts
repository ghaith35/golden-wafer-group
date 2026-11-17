import { describe, expect, it } from "vitest";
import { addDaysKey, algiersDayKey, algiersDayRange, weekStartKey } from "@/lib/tournees/days";

describe("tournée calendar helpers", () => {
  it("weeks start on Saturday", () => {
    expect(weekStartKey("2026-11-13")).toBe("2026-11-07"); // Friday → Saturday before
    expect(weekStartKey("2026-11-07")).toBe("2026-11-07"); // Saturday itself
    expect(weekStartKey("2026-11-08")).toBe("2026-11-07"); // Sunday
  });
  it("adds days across month ends", () => {
    expect(addDaysKey("2026-11-28", 7)).toBe("2026-12-05");
  });
  it("a date-only tour (UTC midnight) falls inside its own Algiers day", () => {
    const d = new Date("2026-11-14");
    expect(algiersDayKey(d)).toBe("2026-11-14");
    const r = algiersDayRange(d);
    expect(d >= r.gte && d < r.lt).toBe(true);
    expect(r.lt.getTime() - r.gte.getTime()).toBe(86_400_000);
  });
  it("an evening instant belongs to the next Algiers day only after 23:00 UTC", () => {
    expect(algiersDayKey(new Date("2026-11-13T22:30:00Z"))).toBe("2026-11-13");
    expect(algiersDayKey(new Date("2026-11-13T23:30:00Z"))).toBe("2026-11-14");
  });
});
