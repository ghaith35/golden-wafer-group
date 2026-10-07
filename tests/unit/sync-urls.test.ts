import { describe, expect, it } from "vitest";
import { serverBaseOf, syncEndpointOf } from "@/lib/sync/urls";

describe("sync urls — scan-once server binding", () => {
  it("base origin stays untouched", () => {
    expect(serverBaseOf("https://client1.distribuili.khiatadz.com")).toBe(
      "https://client1.distribuili.khiatadz.com"
    );
    expect(serverBaseOf("https://client1.distribuili.khiatadz.com/")).toBe(
      "https://client1.distribuili.khiatadz.com"
    );
  });

  it("legacy /api/sync payloads resolve to the origin", () => {
    expect(serverBaseOf("https://client1.distribuili.khiatadz.com/api/sync")).toBe(
      "https://client1.distribuili.khiatadz.com"
    );
    expect(serverBaseOf("http://192.168.1.20:3101/api/sync")).toBe(
      "http://192.168.1.20:3101"
    );
  });

  it("sync endpoint appends /api/sync to base URLs", () => {
    expect(syncEndpointOf("https://client1.distribuili.khiatadz.com")).toBe(
      "https://client1.distribuili.khiatadz.com/api/sync"
    );
    expect(syncEndpointOf("https://client1.distribuili.khiatadz.com/api/sync")).toBe(
      "https://client1.distribuili.khiatadz.com/api/sync"
    );
    expect(syncEndpointOf("/api/sync")).toBe("/api/sync");
    expect(syncEndpointOf("")).toBe("/api/sync");
  });
});
