import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react", () => ({ useEffect: (effect: () => void) => effect(), useState: () => [null, vi.fn()] }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

afterEach(() => vi.unstubAllGlobals());

describe("desktop page loading", () => {
  it("keeps the desktop outside the mobile worker and APK update flow", async () => {
    const register = vi.fn();
    const fetch = vi.fn();
    vi.stubGlobal("window", { distribuili: { isDesktop: true } });
    vi.stubGlobal("navigator", { serviceWorker: { register } });
    vi.stubGlobal("fetch", fetch);
    const { SwRegister } = await import("@/components/pwa/SwRegister");
    const { AutoUpdate } = await import("@/components/sync/AutoUpdate");
    SwRegister();
    AutoUpdate();
    expect(register).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
