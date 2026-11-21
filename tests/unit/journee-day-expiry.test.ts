import { describe, it, expect } from "vitest";
import { journeeState, isPastDaySlug } from "@/lib/journee";

const started = { startedAt: "2026-11-22T09:00:00.000Z", finishedAt: null };

describe("journée lasts only through its own day (Algiers)", () => {
  it("started Sunday, never closed → still active on Sunday", () => {
    const sundayEvening = new Date("2026-11-22T20:00:00.000Z"); // 21:00 Algiers, Sunday
    expect(isPastDaySlug("2026-11-22", sundayEvening)).toBe(false);
    expect(journeeState(started, false, false, isPastDaySlug("2026-11-22", sundayEvening))).toBe("active");
  });

  it("…and ended as soon as Monday begins (23:00 UTC = 00:00 Algiers)", () => {
    const monday = new Date("2026-11-22T23:00:00.000Z");
    expect(isPastDaySlug("2026-11-22", monday)).toBe(true);
    expect(journeeState(started, false, false, isPastDaySlug("2026-11-22", monday))).toBe("ended");
  });

  it("an unstarted day stays idle (nothing to expire) and unpadded slugs parse", () => {
    const monday = new Date("2026-11-23T10:00:00.000Z");
    expect(journeeState(null, false, false, isPastDaySlug("2026-11-22", monday))).toBe("idle");
    expect(isPastDaySlug("2026-11-9", new Date("2026-11-10T10:00:00.000Z"))).toBe(true);
    expect(isPastDaySlug(undefined)).toBe(false);
  });
});
