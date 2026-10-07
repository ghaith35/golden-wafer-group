import { expect, test } from "@playwright/test";

// PC smoke: the pages a client will open on delivery day.
// Run: BASE_URL=http://localhost:3000 npx playwright test
// These are intentionally read-only except loginEmployer; they fail fast
// if routing/i18n/auth breaks, without touching business data.

test.describe("PC delivery-day smoke", () => {
  test("health endpoint answers", async ({ request }) => {
    const r = await request.get("/api/health");
    expect(r.ok()).toBeTruthy();
  });

  test("login page renders (ar default)", async ({ page }) => {
    await page.goto("/ar/login");
    await expect(page.locator("body")).toContainText(/دخول|تسجيل|Distribuili/i, { timeout: 15000 });
  });

  test("sync endpoint rejects anonymous body with 400/401, never 500", async ({ request }) => {
    const r = await request.post("/api/sync", { data: {} });
    expect([400, 401]).toContain(r.status());
  });

  test("sync endpoint rejects bad device token with 401", async ({ request }) => {
    const r = await request.post("/api/sync", { data: { deviceToken: "wrong-token-12345678", ops: [] } });
    expect([400, 401]).toContain(r.status());
  });
});
