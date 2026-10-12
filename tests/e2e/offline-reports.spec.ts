import { expect, test, type Page } from "@playwright/test";

// Admin sales-by-van report: van buttons → one van's sales, profit,
// expenses, hours, products + top product. Deterministic fixture van
// "Camion Rapport" (total 200, profit 80, expenses 30, 8h, top PRD-001).
//   BASE_URL=http://localhost:3000 PW_SKIP_SERVER=1 npx playwright test offline-reports

const ADMIN = process.env.E2E_ADMIN ?? "ghaith@gmail.com";
const APASS = process.env.E2E_ADMIN_PASS ?? "test1234";

async function login(page: Page) {
  await page.goto("/ar/login");
  await page.locator("#login-username").fill(ADMIN);
  await page.locator("#login-password").fill(APASS);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/ar\/dashboard/, { timeout: 20_000 });
}

test.describe("admin van sales report", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("van buttons → fixed numbers for the fixture van", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error" && !/favicon|404/.test(m.text())) {
        errors.push(`console: ${m.text().slice(0, 200)}`);
      }
    });

    await login(page);
    await page.goto("/ar/reports", { timeout: 20_000 });
    // Removed sections stay gone (no tabs, no CSV, no debt/margin UI).
    await expect(page.locator("body")).not.toContainText(/تصدير CSV|Export CSV/, { timeout: 10_000 });
    await page.getByTestId("van-e2evanrep00000000000001").click();
    const report = page.getByTestId("van-report");
    await expect(report).toBeVisible({ timeout: 15_000 });
    await expect(report).toContainText(/200/, { timeout: 10_000 });
    await expect(report).toContainText(/80/, { timeout: 10_000 });
    await expect(report).toContainText(/30/, { timeout: 10_000 });
    await expect(report).toContainText(/8/, { timeout: 10_000 });
    await expect(report).toContainText(/منتج تجريبي/, { timeout: 10_000 });

    expect(errors.filter((e) => !e.includes("favicon"))).toEqual([]);
  });
});
