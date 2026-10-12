import { describe, expect, it } from "vitest";
import {
  compareVersions,
  isNewerThan,
  parseManifest,
  parseSemver,
  sameHash,
} from "../../electron/bundle-feed";

describe("bundle-feed semver", () => {
  it("parses strict 3-part versions only", () => {
    expect(parseSemver("1.2.3")).toEqual([1, 2, 3]);
    expect(parseSemver(" 10.0.1 ")).toEqual([10, 0, 1]);
    expect(parseSemver("1.2")).toBe(null);
    expect(parseSemver("v1.2.3")).toBe(null);
    expect(parseSemver("1.2.3-beta")).toBe(null);
    expect(parseSemver("")).toBe(null);
  });

  it("compares numerically, not lexicographically", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.10", "1.2.9")).toBe(1);
    expect(compareVersions("0.1.1", "0.1.2")).toBe(-1);
    expect(compareVersions("2.0.0", "10.0.0")).toBe(-1);
    expect(() => compareVersions("1.2", "1.2.3")).toThrow();
  });

  it("applies only strictly newer versions (never downgrades)", () => {
    expect(isNewerThan("0.1.2", "0.1.1")).toBe(true);
    expect(isNewerThan("0.1.1", "0.1.1")).toBe(false);
    expect(isNewerThan("0.1.0", "0.1.1")).toBe(false);
  });
});

describe("bundle-feed manifest", () => {
  const good = {
    version: "0.1.2",
    bundle_url: "https://example.com/updates/bundle-0.1.2.tar.gz",
    sha256: "a".repeat(64),
    builtAt: "2026-01-01T00:00:00Z",
  };

  it("accepts a valid manifest", () => {
    expect(parseManifest(good)).toEqual(good);
  });

  it("rejects bad shapes", () => {
    expect(() => parseManifest(null)).toThrow();
    expect(() => parseManifest({ ...good, version: "1.2" })).toThrow();
    expect(() => parseManifest({ ...good, bundle_url: "http://x/y.tar.gz" })).toThrow();
    expect(() => parseManifest({ ...good, bundle_url: "http://192.168.1.50/y.tar.gz" })).toThrow();
    expect(() => parseManifest({ ...good, sha256: "xyz" })).toThrow();
    expect(() => parseManifest({ ...good, builtAt: "" })).toThrow();
  });

  it("allows http tarballs on loopback for local trials", () => {
    expect(parseManifest({ ...good, bundle_url: "http://127.0.0.1:8901/bundle-0.1.2.tar.gz" }).bundle_url).toContain("127.0.0.1");
    expect(parseManifest({ ...good, bundle_url: "http://localhost:8901/bundle-0.1.2.tar.gz" }).bundle_url).toContain("localhost");
  });

  it("compares hashes case-insensitively", () => {
    expect(sameHash("A".repeat(64), "a".repeat(64))).toBe(true);
    expect(sameHash("a".repeat(64), "b".repeat(64))).toBe(false);
  });
});
