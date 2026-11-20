import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

const origin = "https://shop.example";
const dashboard = (day: string) => `${origin}/ar/livreur/${day}/dashboard`;
const cacheName = "dili-sw-v12-pages";
const worker = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

function setup() {
  const stores = new Map<string, Map<string, Response>>();
  const address = (input: Request | string) => new URL(typeof input === "string" ? input : input.url, origin).href;
  const store = (name: string) => {
    let entries = stores.get(name);
    if (!entries) {
      entries = new Map();
      stores.set(name, entries);
    }
    return entries;
  };
  const savedPage = (href: string) => {
    const page = new Response("driver dashboard", { headers: { "content-type": "text/html" } });
    Object.defineProperties(page, {
      url: { value: href },
      clone: { value: () => savedPage(href) },
    });
    return page;
  };
  let online = false;
  let rejectNetwork = false;
  const context = createContext({
    self: { addEventListener() {} },
    location: { origin },
    URL,
    Response,
    Date: class extends Date {
      constructor() { super(2026, 10, 17); }
    },
    caches: {
      async match(input: Request | string, options?: { cacheName: string }) {
        const candidates = options ? [store(options.cacheName)] : [...stores.values()];
        return candidates.map((entries) => entries.get(address(input))).find(Boolean);
      },
      async open(name: string) {
        const entries = store(name);
        return {
          async keys() { return [...entries.keys()].map((url) => ({ url })); },
          async put(input: string, page: Response) { entries.set(address(input), page); },
        };
      },
    },
    fetch: async (req: Request) => {
      if (rejectNetwork) throw new TypeError("Failed to fetch");
      return online ? savedPage(req.url) : new Response("shop unreachable", { status: 530 });
    },
  });
  runInContext(worker, context);
  return {
    save(href: string) { store(cacheName).set(href, savedPage(href)); },
    setOnline(value: boolean) { online = value; },
    disconnect() { rejectNetwork = true; },
    dropRollingPages() { stores.delete(cacheName); },
    async request(url: string, mode = "navigate"): Promise<Response> {
      const writes: Promise<unknown>[] = [];
      const response = await context.docResponse({
        request: { url, mode },
        waitUntil(write: Promise<unknown>) { writes.push(write); },
      });
      await Promise.all(writes);
      return response;
    },
  };
}

describe("offline driver startup", () => {
  it("opens the latest saved dashboard weeks later, even after rolling pages are cleared", async () => {
    const app = setup();
    const latest = dashboard("2026-10-12");
    app.save(dashboard("2026-10-9"));
    app.save(latest);

    const response = await app.request(dashboard("2026-11-17") + "?device=old-token");
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toContain("__DILI_DAY_SHIFTED");
    expect(await (await app.request(latest)).text()).toBe("driver dashboard");
    app.dropRollingPages();

    const afterClear = await app.request(dashboard("2026-11-17"));
    expect(afterClear.status).toBe(200);
    expect(await afterClear.text()).toContain("driver dashboard");
    expect(await (await app.request(latest)).text()).toBe("driver dashboard");
  });

  it("retains the dashboard and login after an online visit and a network disconnect", async () => {
    const app = setup();
    const lastOpened = dashboard("2026-10-12");
    const login = origin + "/ar/login";

    app.setOnline(true);
    await app.request(lastOpened);
    await app.request(login);
    app.dropRollingPages();
    app.disconnect();

    const next = await app.request(dashboard("2026-11-17"));
    expect(next.status).toBe(200);
    expect(await next.text()).toContain("driver dashboard");
    expect(await (await app.request(lastOpened)).text()).toBe("driver dashboard");
    expect(await (await app.request(login)).text()).toBe("driver dashboard");
  });

  it("serves today's cached dashboard when it exists", async () => {
    const app = setup();
    app.save(dashboard("2026-10-12"));
    app.save(dashboard("2026-11-17"));

    expect(await (await app.request(dashboard("2026-11-17"))).text()).toBe("driver dashboard");
  });

  it("does not redirect a warmup fetch to another day", async () => {
    const app = setup();
    app.save(dashboard("2026-10-12"));

    const response = await app.request(dashboard("2026-11-17"), "cors");
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).not.toBe("driver dashboard");
  });

  it("relabels any cached journée screen of an older day (vente, factures…) for today", async () => {
    const app = setup();
    app.save(origin + "/ar/livreur/2026-10-12/vente");
    app.save(origin + "/ar/livreur/2026-10-9/vente");

    const response = await app.request(origin + "/ar/livreur/2026-11-17/vente");
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("driver dashboard");
    expect(body).toContain('__DILI_DAY_SHIFTED="2026-10-12"');
  });
});
