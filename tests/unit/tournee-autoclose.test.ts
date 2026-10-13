import { describe, expect, it } from "vitest";
import { algiersDayKey, endOfAlgiersDay, isPastAlgiersDay } from "@/lib/tournees/days";

// Algeria is UTC+1 with no DST: a UTC evening instant is already "tomorrow"
// in Algiers, and the auto-close stamp must land at 23:59:59 Algiers (=
// 22:59:59 UTC) of the tournee's OWN day — never the next one.
describe("algiers journée calendar", () => {
  it("day key follows Africa/Algiers, not UTC", () => {
    // 2026-10-12 23:30 UTC = 2026-10-13 00:30 Algiers.
    expect(algiersDayKey(new Date(Date.UTC(2026, 9, 12, 23, 30)))).toBe("2026-10-13");
    expect(algiersDayKey(new Date(Date.UTC(2026, 9, 12, 22, 30)))).toBe("2026-10-12");
  });

  it("auto-close stamp is end-of-OWN-day in Algiers", () => {
    const end = endOfAlgiersDay(new Date(Date.UTC(2026, 9, 12, 10, 0)));
    expect(end.toISOString()).toBe("2026-10-12T22:59:59.999Z");
    expect(algiersDayKey(end)).toBe("2026-10-12");
  });

  it("past-day detection ignores time-of-day", () => {
    const now = new Date(Date.UTC(2026, 9, 13, 8, 0)); // Oct 13 morning Algiers
    expect(isPastAlgiersDay(new Date(Date.UTC(2026, 9, 12, 20, 0)), now)).toBe(true);
    expect(isPastAlgiersDay(new Date(Date.UTC(2026, 9, 13, 0, 30)), now)).toBe(false);
    expect(isPastAlgiersDay(now, now)).toBe(false);
  });
});
