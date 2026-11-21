import { expect, test, type Page } from "@playwright/test";

// Offline-created docs (queued tickets/orders) must be visible, openable,
// printable and shareable with zero connection — the driver sees his sale
// the moment he saves it, not after the next sync.
// Runs against an ISOLATED production server (SW active) on a throwaway DB:
//   BASE_URL=http://localhost:3000 PW_SKIP_SERVER=1 npx playwright test offline-pending-docs
// (server: DISTRIBUILI_DB=local DISTRIBUILI_SQLITE_URL=file:/tmp/e2e-test.db next start)

const USER = process.env.E2E_USER ?? "ghaith";
const PASS = process.env.E2E_PASS ?? "test1234";
const DAY = "2026-10-11";
const CLIENT = "cmv4duzwp0002w5e70ecc4tsq"; // CLT-0001 in the throwaway DB

async function login(page: Page) {
  await page.goto("/ar/login");
  await page.locator("#login-username").fill(USER);
  await page.locator("#login-password").fill(PASS);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/ar\/livreur/, { timeout: 20_000 });
}

test.describe("offline pending docs (ticket + order)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("queue offline → visible → open → print, discard works", async ({ page, context }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    // Transport noise the app absorbs by design (SW serves cache or the
    // import .catch() degrades): offline fails + chunk loads refused under
    // load, which reject honestly and never poison the module graph.
    page.on("console", (m) => {
      if (m.type() === "error" && !/ERR_INTERNET_DISCONNECTED|ERR_FAILED|favicon|404/.test(m.text())) {
        errors.push(`console: ${m.text().slice(0, 200)}`);
      }
    });

    await login(page);

    // Warm every page + query variant while online (SW cache + SSR props).
    for (const u of [
      `/ar/livreur/${DAY}/dashboard`,
      `/ar/livreur/${DAY}`,
      `/ar/livreur/${DAY}/vente?client=${CLIENT}`,
      `/ar/livreur/${DAY}/commande?client=${CLIENT}`,
      `/ar/livreur/${DAY}/factures`,
      `/ar/livreur/${DAY}/commandes`,
    ]) {
      await page.goto(u, { timeout: 20_000 });
      await page.waitForTimeout(700);
    }
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 20_000 });

    await context.setOffline(true);

    // ── 1. Mixed-tier sale offline → queued + preview ──
    // Line 1 at base sell (150), toggle Gros, line 2 at Gros (170).
    // Toggling never rewrites line 1; products without a Gros price
    // would keep base (both fixtures have one).
    await page.goto(`/ar/livreur/${DAY}/vente?client=${CLIENT}`, { timeout: 20_000 });
    await page.locator('[role="button"]', { hasText: "منتج تجريبي" }).first().click();
    await page.getByTestId("qty-confirm").click();
    await page.locator("button", { hasText: /^Gros$/ }).first().click();
    await expect(page.locator("body")).toContainText(/130/, { timeout: 10_000 });
    await page.locator('[role="button"]', { hasText: "منتج ثاني" }).first().click();
    await page.getByTestId("qty-confirm").click();
    await page.getByTestId("cart-bar").click();
    // Recap: line 1 kept base (badge سعر البيع), line 2 Gros, total 320.
    await expect(page.locator("body")).toContainText(/سعر البيع|Prix de vente|Sell price/, { timeout: 10_000 });
    await expect(page.locator("body")).toContainText(/Gros/, { timeout: 10_000 });
    // Each line has its own delete button (no more qty-to-zero dance).
    await expect(page.getByRole("button", { name: /إزالة|Remove|Retirer/ })).toHaveCount(2);
    await page.getByTestId("confirm-sale").click();
    // Preview renders from the local snapshot (number assigned on sync).
    await expect(page.locator("body")).toContainText(/320/, { timeout: 10_000 });

    // ── 2. Factures shows the pending ticket, opens, prints ──
    // (the pending row itself PROVES the outbox write — same store the
    // phone reads; desktop Chrome persists it via IndexedDB, not localStorage)
    await page.goto(`/ar/livreur/${DAY}/factures`, { timeout: 20_000 });
    await expect(page.locator("body")).toContainText(/غير متزامن|Non synchronisé|Unsynced|بانتظار المزامنة|⏳/, { timeout: 10_000 });
    await page.getByTestId("view-doc").first().click();
    const detail = page.getByRole("dialog");
    await expect(detail).toBeVisible({ timeout: 10_000 });
    await expect(detail).toContainText(/منتج تجريبي|…/, { timeout: 10_000 });
    // Edit stays disabled for pending docs (no server id to edit).
    await expect(detail.getByRole("button", { name: /تعديل|Edit|Modifier/ })).toBeDisabled({ timeout: 10_000 });
    await page.getByTestId("pv-print").click();
    await expect(page.locator("body")).toContainText(/320/, { timeout: 10_000 });
    // Share → in-app A4 viewer (same content as the PDF) → share → download.
    await page.getByTestId("pv-share").click();
    const viewer = page.getByRole("dialog", { name: "Aperçu facture" });
    await expect(viewer).toContainText(/320/, { timeout: 10_000 });
    const dl = await Promise.all([
      page.waitForEvent("download", { timeout: 15_000 }),
      page.getByTestId("pv-share-confirm").click(),
    ]).then(([d]) => d);
    expect(dl.suggestedFilename()).toMatch(/\.pdf$/);
    // Share feedback inside the viewer (saved ✓ on desktop Chromium).
    await expect(viewer).toContainText(/✓/, { timeout: 10_000 });

    // ── 4. Discard the pending ticket → gone from the list ──
    // Fresh load clears all modal state (the print preview has no Esc close).
    await page.goto(`/ar/livreur/${DAY}/factures`, { timeout: 20_000 });
    await page.goto(`/ar/livreur/${DAY}/commande?client=${CLIENT}`, { timeout: 20_000 });
    await page.locator('[role="button"]', { hasText: "منتج تجريبي" }).first().click();
    await page.getByTestId("qty-confirm").click();
    await page.getByTestId("cart-bar").click();
    await page.getByTestId("send-order").click();
    await page.waitForTimeout(1000);
    await page.goto(`/ar/livreur/${DAY}/commandes`, { timeout: 20_000 });
    await expect(page.locator("body")).toContainText(/غير متزامن|Non synchronisé|Unsynced|DRAFT|…/, { timeout: 10_000 });
    await page.getByTestId("view-doc").first().click();
    await expect(page.locator('[role="dialog"]')).toContainText(/منتج تجريبي|…/, { timeout: 10_000 });

    // ── 4. Discard the pending ticket → gone from the list ──
    await page.goto(`/ar/livreur/${DAY}/factures`, { timeout: 20_000 });
    const before = await page.getByTestId("view-doc").count();
    await page.getByTestId("delete-doc").first().click();
    await page.getByRole("button", { name: /نعم|oui|yes/i }).click();
    await expect(page.locator("body")).toContainText(/حُذف من الهاتف|Supprimé|Deleted/, { timeout: 10_000 });
    await expect.poll(async () => page.getByTestId("view-doc").count(), { timeout: 10_000 }).toBe(before - 1);

    expect(errors.filter((e) => !e.includes("favicon"))).toEqual([]);
    await context.setOffline(false);
  });
});
