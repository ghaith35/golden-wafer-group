import { expect, test, type Page } from "@playwright/test";

// A missing asset must preserve the driver's cached screens for the next outage.
//   BASE_URL=http://localhost:3000 PW_SKIP_SERVER=1 npx playwright test sw-chunk-purge

const USER = process.env.E2E_USER ?? "ghaith";
const PASS = process.env.E2E_PASS ?? "test1234";
const DAY = "2026-10-11";

async function pageCacheSize(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const names = await caches.keys();
    let n = 0;
    for (const name of names) {
      if (!name.includes("-pages")) continue;
      n += (await (await caches.open(name)).keys()).length;
    }
    return n;
  });
}

test.describe("sw offline page retention", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("chunk and image 404s preserve the page cache", async ({ page }) => {
    await page.goto("/ar/login");
    await page.locator("#login-username").fill(USER);
    await page.locator("#login-password").fill(PASS);
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL(/\/ar\/livreur/, { timeout: 20_000 });
    await page.goto(`/ar/livreur/${DAY}/dashboard`, { timeout: 20_000 });
    await page.waitForTimeout(1500);

    const before = await pageCacheSize(page);
    expect(before).toBeGreaterThan(0);

    // A rotated chunk from a previous deploy: honest 404, never cached.
    const st = await page.evaluate(async () => {
      const r = await fetch("/_next/static/chunks/rotated-0123456789.js");
      return r.status;
    });
    expect(st).toBe(404);
    await page.waitForTimeout(500);

    const imageStatus = await page.evaluate(async () => (await fetch("/uploads/missing-offline-test.png")).status);
    expect(imageStatus).toBe(404);
    await expect.poll(async () => pageCacheSize(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(before);
  });
});
