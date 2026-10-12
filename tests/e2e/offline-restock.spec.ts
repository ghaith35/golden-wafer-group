import { expect, test, type Page } from "@playwright/test";

// Livreur restock requests (demande produits) + admin validation loop.
// Driver queues depot→van transfer-declares offline (modify/delete included);
// admin validates in vans/orders and stock moves immediately, no van confirm.
// Throwaway DB fixture (depot stock, TRF-9000 to ghaith's van):
//   BASE_URL=http://localhost:3000 PW_SKIP_SERVER=1 npx playwright test offline-restock

const DRIVER = process.env.E2E_USER ?? "ghaith";
const DPASS = process.env.E2E_PASS ?? "test1234";
const ADMIN = process.env.E2E_ADMIN ?? "ghaith@gmail.com";
const APASS = process.env.E2E_ADMIN_PASS ?? "test1234";
const SAT = "2026-10-11";
// ghaith's van + PRD-001 (stable cuids from the live backup the fixture copies).
const VAN_ID = "cmv4d0y7t00090ze7e8bwrcs2";
const PROD_ID = "cmv4duzws0003w5e7jkyipe1c";

async function vanDepotStock(page: Page): Promise<{ van: number; depot: number }> {
  const d = await page.evaluate(async ({ vanId, prodId }) => {
    const r = await fetch(`/api/vans/${vanId}/holds`, { cache: "no-store" });
    const j = await r.json().catch(() => null);
    const holds = (j?.holds ?? []) as Array<{ productId: string; vanStock: number }>;
    const depot = (j?.depot ?? []) as Array<{ productId: string; qty: number }>;
    return {
      van: Number(holds.find((h) => h.productId === prodId)?.vanStock ?? -1),
      depot: Number(depot.find((x) => x.productId === prodId)?.qty ?? -1),
    };
  }, { vanId: VAN_ID, prodId: PROD_ID });
  return d as { van: number; depot: number };
}

async function login(page: Page, user: string, pass: string, where: RegExp) {
  await page.goto("/ar/login");
  await page.locator("#login-username").fill(user);
  await page.locator("#login-password").fill(pass);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(where, { timeout: 20_000 });
}

test.describe("restock requests (driver + admin)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("queue offline → modify → sync → admin validates", async ({ page, context }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error" && !/ERR_INTERNET_DISCONNECTED|ERR_FAILED|favicon|404/.test(m.text())) {
        errors.push(`console: ${m.text().slice(0, 200)}`);
      }
    });

    await login(page, DRIVER, DPASS, /\/ar\/livreur/);
    for (const u of [`/ar/livreur/${SAT}/dashboard`, `/ar/livreur/${SAT}/demande`]) {
      await page.goto(u, { timeout: 20_000 });
      await page.waitForTimeout(800);
    }
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 20_000 });

    // Pair while online so the later flush has a device (zero-touch).
    await page.goto(`/ar/livreur/${SAT}/dashboard`, { timeout: 20_000 });
    await page.locator("button", { hasText: /مزامنة|Sync/ }).first().click();
    await page.waitForTimeout(12000);
    await page.keyboard.press("Escape");
    // Baseline van/depot stock for the movement assert at the end.
    const base = await vanDepotStock(page);

    await context.setOffline(true);

    // ── 1. Queue a restock request offline ──
    await page.goto(`/ar/livreur/${SAT}/demande`, { timeout: 20_000 });
    await expect(page.locator("body")).toContainText(/طلب بضاعة|Demande|Request/, { timeout: 10_000 });
    await page.locator('[role="button"]', { hasText: "منتج تجريبي" }).first().click();
    await page.getByTestId("qty-confirm").click();
    await page.getByTestId("restock-recap").click();
    await page.getByTestId("send-restock").click();
    await expect(page.locator("body")).toContainText(/سيُزامَن|queued|⏳/, { timeout: 10_000 });

    // ── 2. Pending row visible → modify qty → still pending ──
    await expect(page.locator("body")).toContainText(/…/, { timeout: 10_000 });
    await page.locator("button", { hasText: /تعديل|Modifier|Edit/ }).first().click();
    // recap bump +: first + button in the recap list
    await page.getByRole("button", { name: "+" }).first().click();
    await page.getByTestId("send-restock").click();
    await expect(page.locator("body")).toContainText(/سيُزامَن|queued|⏳/, { timeout: 10_000 });

    // ── 3. Online → flush → request reaches the server ──
    await context.setOffline(false);
    await page.goto(`/ar/livreur/${SAT}/dashboard`, { timeout: 20_000 });
    await page.locator("button", { hasText: /مزامنة|Sync/ }).first().click();
    await page.getByTestId("sync-start").click();
    await expect(page.getByTestId("sync-start")).toBeEnabled({ timeout: 60_000 });
    await page.waitForTimeout(2000);
    await page.keyboard.press("Escape");

    // ── 4. Admin validates → stock moves, no van confirm ──
    await context.clearCookies();
    await login(page, ADMIN, APASS, /\/ar\/dashboard/);
    await page.goto("/ar/vans/orders", { timeout: 20_000 });
    await expect(page.locator("body")).toContainText(/طلبات الشاحنات|Demandes|Van requests/, { timeout: 10_000 });
    const validate = page.getByTestId(/validate-/).first();
    const beforeCount = await page.getByTestId(/validate-/).count();
    await validate.click(); // arm
    await validate.click(); // execute
    // Validated row leaves the DECLARED set (confirmed immediately).
    // TRF-9000 (fixture) stays put — proving the driver's new request
    // is the one that moved.
    await expect.poll(async () => page.getByTestId(/validate-/).count(), { timeout: 15_000 }).toBe(beforeCount - 1);
    await expect(page.locator("body")).toContainText(/TRF-9000/, { timeout: 10_000 });

    // ── 5. Stock really moved depot → van (not a vacuous confirm) ──
    const after = await vanDepotStock(page);
    expect(after.van).toBe(base.van + 2);
    expect(after.depot).toBe(base.depot - 2);

    expect(errors.filter((e) => !e.includes("favicon"))).toEqual([]);
    await context.setOffline(false);
  });
});
