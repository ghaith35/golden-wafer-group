import { expect, test, type Page } from "@playwright/test";

// Full journée offline regression (livreur phone path).
// Runs against the PRODUCTION server (SW active — never the dev server):
//   BASE_URL=http://localhost:32517 PW_SKIP_SERVER=1 npx playwright test offline-journee
// Flow: login online → walk the whole journée (warms SW cache + snapshot)
// → cut the network → every page must still render (cached doc, snapshot
// data, or our friendly offline page — NEVER the browser error page).

const USER = process.env.E2E_USER ?? "ahmed";
const PASS = process.env.E2E_PASS ?? "ahmed2002";

function daySlug(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

async function login(page: Page) {
  await page.goto("/ar/login");
  await page.locator("#login-username").fill(USER);
  await page.locator("#login-password").fill(PASS);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/ar\/livreur/, { timeout: 20_000 });
}

async function expectUsable(page: Page, url: string, marker: RegExp) {
  // goto throws net::ERR_* when the browser itself fails (no SW answer).
  await page.goto(url, { timeout: 20_000 });
  await expect(page.locator("body")).toContainText(marker, { timeout: 10_000 });
}

test.describe("livreur journée works fully offline", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("walk online, then everything renders offline", async ({ page, context }) => {
    const errors: string[] = [];
    const failedReqs: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error" && !m.text().includes("ERR_INTERNET_DISCONNECTED")) {
        errors.push(`console: ${m.text().slice(0, 200)}`);
      }
    });
    page.on("requestfailed", (r) => {
      failedReqs.push(`${r.url().replace(/^https?:\/\/[^/]+/, "")} :: ${r.failure()?.errorText ?? ""}`);
    });

    await login(page);
    const slug = daySlug(new Date());
    const urls = [
      `/ar/livreur`,
      `/ar/livreur/${slug}/start`,
      `/ar/livreur/${slug}`,
      `/ar/livreur/${slug}/dashboard`,
      `/ar/livreur/${slug}/vente`,
      `/ar/livreur/${slug}/commande`,
      `/ar/livreur/${slug}/stock`,
      `/ar/livreur/${slug}/factures`,
      `/ar/livreur/${slug}/commandes`,
    ];
    for (const u of urls) {
      await page.goto(u, { timeout: 20_000 });
      await page.waitForTimeout(800);
    }

    // Service worker must own the page before we cut the network.
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 20_000 });

    await context.setOffline(true);

    // Every journée page renders offline (cached doc, never browser error).
    await expectUsable(page, `/ar/livreur/${slug}/dashboard`, /مرسيدس|mercedes|بيع الشاحنة|Tournée|Van sale/i);
    await expectUsable(page, `/ar/livreur/${slug}`, /زبائن|Clients/i);
    await expectUsable(page, `/ar/livreur/${slug}/start`, /mercedes|زبائن|Clients|جournée|Journée/i);
    await expectUsable(page, `/ar/livreur/${slug}/vente`, /./);
    await expectUsable(page, `/ar/livreur/${slug}/commande`, /./);
    await expectUsable(page, `/ar/livreur/${slug}/stock`, /./);
    await expectUsable(page, `/ar/livreur/${slug}/factures`, /./);
    // Query variants fall back to the base document, never an error page.
    await expectUsable(page, `/ar/livreur/${slug}/dashboard?client=abc`, /./);
    // QR badge tab offers the camera offline too (unlock against the cached
    // badge) — never the "connect once" wall. Drop only the unlock so the
    // form stays (the credential remains for the username hint).
    await page.evaluate(() => {
      try { localStorage.removeItem("dili_offline_unlocked_v1"); } catch { /* ignore */ }
    });
    await page.goto(`/ar/login`, { timeout: 20_000 });
    await page.locator("button", { hasText: /رمز QR/ }).click();
    await expect(page.locator("body")).toContainText(/تشغيل الكاميرا/, { timeout: 10_000 });

    // No JS runtime errors anywhere in the offline walk.
    expect(errors.filter((e) => !e.includes("favicon"))).toEqual([]);
    // Log every failed request for triage (API calls have offline fallbacks;
    // documents/static must never fail — the SW covers them).
    console.log("FAILED-REQS:\n" + [...new Set(failedReqs)].slice(0, 30).join("\n"));

    await context.setOffline(false);
  });
});
