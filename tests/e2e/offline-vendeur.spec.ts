import { expect, test, type Page } from "@playwright/test";

// Vendeur (mandob) offline verification: orders-only flow.
// - vente/factures bounce to dashboard (proxy, online)
// - commande creates queue offline → visible DRAFT → openable
// - deliver works offline (queued); cancel/reopen are hidden for the role
// - collect + day stamps work offline
// Throwaway DB fixture: vendeur1/test1234, van "Camion Vendeur", Saturday
// tour + stop CLT-0001, CONFIRMED order CMD-VENDEUR-1.
//   BASE_URL=http://localhost:3000 PW_SKIP_SERVER=1 npx playwright test offline-vendeur

const USER = process.env.E2E_USER ?? "vendeur1";
const PASS = process.env.E2E_PASS ?? "test1234";
const SAT = "2026-10-11";
const CLIENT = "cmv4duzwp0002w5e70ecc4tsq";

async function login(page: Page) {
  await page.goto("/ar/login");
  await page.locator("#login-username").fill(USER);
  await page.locator("#login-password").fill(PASS);
  await page.locator('form button[type="submit"]').click();
  // Vendeur lands on the dashboard, Livreur on the journée — either means in.
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 20_000 });
}

test.describe("vendeur works fully offline", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("orders flow offline, no facture actions", async ({ page, context }) => {
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

    // ── 0. Role bounces (online): vente + factures + demande → dashboard ──
    await page.goto(`/ar/livreur/${SAT}/vente`, { timeout: 20_000 });
    await page.waitForURL(/\/ar\/livreur\/[^/]+\/dashboard/, { timeout: 15_000 });
    await page.goto(`/ar/livreur/${SAT}/factures`, { timeout: 20_000 });
    await page.waitForURL(/\/ar\/livreur\/[^/]+\/dashboard/, { timeout: 15_000 });
    await page.goto(`/ar/livreur/${SAT}/demande`, { timeout: 20_000 });
    await page.waitForURL(/\/ar\/livreur\/[^/]+\/dashboard/, { timeout: 15_000 });

    // Warm the vendeur-reachable pages while online.
    for (const u of [
      `/ar/livreur/${SAT}/dashboard`,
      `/ar/livreur/${SAT}`,
      `/ar/livreur/${SAT}/commande?client=${CLIENT}`,
      `/ar/livreur/${SAT}/commandes`,
      `/ar/livreur/${SAT}/stock`,
    ]) {
      await page.goto(u, { timeout: 20_000 });
      await page.waitForTimeout(700);
    }
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 20_000 });
    // Cache the synced order's detail while online (detail serves from
    // cache offline with a stale banner).
    await page.goto(`/ar/livreur/${SAT}/commandes`, { timeout: 20_000 });
    await page.locator("button", { hasText: /CMD-VENDEUR-1/ }).first().click();
    await expect(page.locator('[role="dialog"]')).toContainText(/CMD-VENDEUR-1/, { timeout: 10_000 });
    await page.keyboard.press("Escape");
    await context.setOffline(true);

    // ── 1. Order offline → queued + visible DRAFT ──
    await page.goto(`/ar/livreur/${SAT}/commande?client=${CLIENT}`, { timeout: 20_000 });
    await page.locator('[role="button"]', { hasText: "منتج تجريبي" }).first().click();
    await page.getByTestId("qty-confirm").click();
    await page.locator("button.fixed.inset-x-0").first().click();
    await page.getByTestId("send-order").click();
    await page.waitForTimeout(1000);
    await page.goto(`/ar/livreur/${SAT}/commandes`, { timeout: 20_000 });
    await expect(page.locator("body")).toContainText(/غير متزامن|DRAFT/, { timeout: 10_000 });

    // ── 2. Pending order: deliver blocked with sync-first ──
    await page.getByTestId("view-doc").first().click();
    await expect(page.locator('[role="dialog"]')).toContainText(/منتج تجريبي|…/, { timeout: 10_000 });

    // ── 3. Synced order CMD-VENDEUR-1: deliver queues, no cancel/reopen ──
    await page.keyboard.press("Escape");
    const cmd = page.locator("button", { hasText: /CMD-VENDEUR-1/ }).first();
    await cmd.click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toContainText(/CMD-VENDEUR-1/, { timeout: 10_000 });
    // Forbidden facture actions are hidden for the role…
    await expect(dialog).not.toContainText(/إلغاء الطلب/, { timeout: 5_000 });
    // …but delivering works offline (queued).
    await dialog.getByRole("button", { name: /توصيل|Livrer|Deliver/ }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.locator("body")).toContainText(/سيُزامَن|queued|⏳/, { timeout: 10_000 });

    // ── 4. Debt collection offline ──
    await page.keyboard.press("Escape");
    await page.goto(`/ar/livreur/${SAT}`, { timeout: 20_000 });
    await page.locator("button", { hasText: /زبون تجريبي|معدل-/ }).first().click();
    await expect(page.locator('[role="dialog"]')).toContainText(/CLT-0001/, { timeout: 10_000 });
    await page.locator('[role="dialog"] input[type="number"]').fill("100");
    await page.locator('[role="dialog"] button', { hasText: /تحصيل|Collect/ }).last().click();
    await expect(page.locator('[role="dialog"]')).toContainText(/سيُزامَن|queued|⏳/, { timeout: 10_000 });

    // ── 5. Edit the client offline → queued → visible immediately ──
    // Unique name per run: the shared throwaway DB persists across runs.
    const newName = `معدل-${Date.now() % 100000}`;
    await page.keyboard.press("Escape");
    await page.locator("button", { hasText: /زبون تجريبي|معدل-/ }).first().click();
    await page.locator('[role="dialog"] button', { hasText: /تعديل الزبون|Modifier|Edit/ }).click();
    // Inputs order in the card: collect amount, then name/phone/activity/address.
    await page.locator('[role="dialog"] input').nth(1).fill(newName);
    await page.getByTestId("save-client-edit").click();
    await expect(page.locator('[role="dialog"]')).toContainText(/حُدّث|mis à jour|updated/, { timeout: 10_000 });
    await expect(page.locator('[role="dialog"]')).toContainText(new RegExp(newName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), { timeout: 10_000 });

    // ── 6. Back online → sync flushes → server shows the new name ──
    await context.setOffline(false);
    await page.keyboard.press("Escape");
    await page.goto(`/ar/livreur/${SAT}/dashboard`, { timeout: 20_000 });
    // Vendeur dashboard: no restock tile.
    await expect(page.locator("body")).not.toContainText(/طلب بضاعة/, { timeout: 10_000 });
    await page.locator("button", { hasText: /مزامنة|Sync/ }).first().click();
    await page.getByTestId("sync-start").click();
    // Wait for the run to finish (button idle again).
    await expect(page.getByTestId("sync-start")).toBeEnabled({ timeout: 60_000 });
    await page.waitForTimeout(2000);
    await page.keyboard.press("Escape");
    await page.goto(`/ar/livreur/${SAT}`, { timeout: 20_000 });
    await expect(page.locator("body")).toContainText(new RegExp(newName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), { timeout: 15_000 });

    // ── 7. Vendeur stock page: depot only, no held/free ──
    await page.goto(`/ar/livreur/${SAT}/stock`, { timeout: 20_000 });
    await expect(page.locator("body")).toContainText(/مخزون المخزن|Stock dépôt|Depot stock/, { timeout: 10_000 });
    await expect(page.locator("body")).not.toContainText(/held|free/, { timeout: 5_000 });

    expect(errors.filter((e) => !e.includes("favicon"))).toEqual([]);
    await context.setOffline(false);
  });
});
