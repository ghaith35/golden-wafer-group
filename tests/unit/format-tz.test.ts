import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUSINESS_TZ, fmtDT } from "@/lib/format";

/// The prod server renders on UTC while the browsers render on Algiers
/// time. Any stored instant formatted without a pinned timezone prints
/// different strings on each side — a React hydration mismatch (#418)
/// that crashes the whole page. These tests fail if the pin is removed.
describe("fmtDT business timezone pin", () => {
  const prev = process.env.TZ;
  beforeEach(() => {});
  afterEach(() => {
    process.env.TZ = prev;
  });

  // 07:30Z == 08:30 in Algiers, year-round (no DST).
  const instant = "2026-11-25T07:30:00.000Z";

  it("renders the same string under any process timezone", () => {
    const seen = new Set<string>();
    for (const tz of ["UTC", "Africa/Algiers", "America/New_York", "Pacific/Auckland"]) {
      process.env.TZ = tz;
      seen.add(fmtDT(instant, "fr-FR"));
      seen.add(fmtDT(instant, "ar-DZ-u-nu-latn"));
    }
    expect(seen.size).toBe(2);
  });

  it("shows the Algiers wall time, not the server one", () => {
    process.env.TZ = "UTC";
    expect(fmtDT(instant, "fr-FR")).toContain("08:30");
  });

  it("exports the pinned zone", () => {
    expect(BUSINESS_TZ).toBe("Africa/Algiers");
  });
});
