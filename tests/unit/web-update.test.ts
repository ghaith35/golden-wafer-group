import { describe, expect, it, vi, beforeEach } from "vitest";
import { shouldPromptWebUpdate, storedBuild, rememberBuild } from "@/lib/sync/web-update";

function stubStorage(value: string | null) {
  const store = new Map<string, string>();
  if (value !== null) store.set("dili_web_build", value);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("web-update prompt decision", () => {
  it("no prompt on first sighting, empty, or same build", () => {
    expect(shouldPromptWebUpdate(null, "abc")).toBe(false);
    expect(shouldPromptWebUpdate("abc", "")).toBe(false);
    expect(shouldPromptWebUpdate("abc", "abc")).toBe(false);
  });

  it("prompts when the server moved", () => {
    expect(shouldPromptWebUpdate("abc", "def")).toBe(true);
  });

  it("storedBuild/rememberBuild round-trip", () => {
    stubStorage(null);
    expect(storedBuild()).toBe(null);
    rememberBuild("xyz");
    expect(storedBuild()).toBe("xyz");
  });
});
