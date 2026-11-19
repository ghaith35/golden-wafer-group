import { describe, expect, it } from "vitest";
import { LAST_PAGE_KEY, recoveryDestination } from "@/lib/navigation-recovery";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe("navigation recovery", () => {
  it("retries once, returns to a working screen, and never loops between failures", () => {
    const store = storage();
    store.setItem(LAST_PAGE_KEY, "/ar/clients");
    expect(recoveryDestination("/ar/tournees", store)).toBe("/ar/tournees");
    expect(recoveryDestination("/ar/tournees", store)).toBe("/ar/clients");
    expect(recoveryDestination("/ar/clients", store)).toBe("/ar/dashboard");
    expect(recoveryDestination("/ar/dashboard", store)).toBeNull();
  });

  it("keeps drivers in their day flow when returning from a failed section", () => {
    const store = storage();
    const path = "/fr/livreur/2026-11-18/vente";
    expect(recoveryDestination(path, store)).toBe(path);
    expect(recoveryDestination(path, store)).toBe("/fr/livreur/2026-11-18/dashboard");
    expect(recoveryDestination("/fr/livreur/2026-11-18/dashboard", store)).toBeNull();
  });

  it("stays usable when storage fails and never follows a foreign return address", () => {
    const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
    expect(recoveryDestination("/ar/clients", blocked)).toBeNull();
    const store = storage();
    store.setItem(LAST_PAGE_KEY, "https://other.example/ar/dashboard");
    recoveryDestination("/ar/clients", store);
    expect(recoveryDestination("/ar/clients", store)).toBe("/ar/dashboard");
  });
});
