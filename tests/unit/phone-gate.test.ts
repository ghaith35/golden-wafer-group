import { describe, expect, it } from "vitest";
import { isDesktopUserAgent } from "@/lib/license/gate";

describe("isDesktopUserAgent", () => {
  it("matches the Electron shell UA", () => {
    expect(isDesktopUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36 Electron/42.5.0")).toBe(true);
  });
  it("rejects phone and desktop browsers", () => {
    expect(isDesktopUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe(false);
    expect(isDesktopUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36")).toBe(false);
    expect(isDesktopUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138 Safari/537.36")).toBe(false);
    expect(isDesktopUserAgent(null)).toBe(false);
    expect(isDesktopUserAgent(undefined)).toBe(false);
  });
});
