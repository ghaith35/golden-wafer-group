import { test } from "@playwright/test";

// Probe: CMD detail dialog buttons offline (fresh fixture).
const USER = process.env.E2E_USER ?? "vendeur1";
const PASS = process.env.E2E_PASS ?? "test1234";
const SAT = "2026-10-11";

test("probe cmd dialog", async ({ page, context }) => {
  await page.goto("/ar/login");
  await page.locator("#login-username").fill(USER);
  await page.locator("#login-password").fill(PASS);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 20_000 });
  await page.goto(`/ar/livreur/${SAT}/commandes`, { timeout: 20_000 });
  await page.waitForTimeout(1500);
  await page.locator("button", { hasText: /CMD-VENDEUR-1/ }).first().click();
  await page.waitForTimeout(2000);
  console.log("ONLINE-BTNS:", await page.locator('[role="dialog"] button').allInnerTexts().catch(() => ["NO-DIALOG"]));
  await page.keyboard.press("Escape");
  await context.setOffline(true);
  await page.goto(`/ar/livreur/${SAT}/commandes`, { timeout: 20_000 });
  await page.locator("button", { hasText: /CMD-VENDEUR-1/ }).first().click();
  await page.waitForTimeout(2000);
  console.log("OFFLINE-BTNS:", await page.locator('[role="dialog"] button').allInnerTexts().catch(() => ["NO-DIALOG"]));
});
