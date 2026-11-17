import { describe, expect, it } from "vitest";
import { clampZoom, stepZoom, ZOOM_MAX, ZOOM_MIN } from "@/lib/ui-zoom";

describe("ui zoom", () => {
  it("steps by 10 and clamps to 70–150", () => {
    expect(stepZoom(100, 1)).toBe(110);
    expect(stepZoom(100, -1)).toBe(90);
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
  });
  it("sanitises stored values", () => {
    expect(clampZoom("abc")).toBe(100);
    expect(clampZoom(undefined)).toBe(100);
    expect(clampZoom("113")).toBe(110);
    expect(clampZoom(999)).toBe(150);
  });
});
