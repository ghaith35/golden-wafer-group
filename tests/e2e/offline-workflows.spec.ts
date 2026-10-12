import { expect, test, type Page } from "@playwright/test";

// Van receipt (transfer confirm) + debt collection (versement), zero
// connection. Staff are 403 on the transfers/versements APIs by design, so
// both flows are queue-only — which is exactly what makes them offline-safe.
// Runs against the isolated production server on the throwaway DB
// (TRF-9000 DECLARED depot→van + Sunday stop CLT-0001 are seeded there):
//   BASE_URL=http://localhost:3000 PW_SKIP_SERVER=1 npx playwright test offline-workflows

const USER = process.env.E2E_USER ?? "ghaith";
const PASS = process.env.E2E_PASS ?? "test1234";
const SAT = "2026-10-11";
const SUN = "2026-10-12";

async function login(page: Page) {
  await page.goto("/ar/login");
  await page.locator("#login-username").fill(USER);
  await page.locator("#login-password").fill(PASS);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/ar\/livreur/, { timeout: 20_000 });
}

test.describe("offline workflows (transfers + collection)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("collect debt offline, no van approval UI", async ({ page, context }) => {
    const t0 = Date.now();
    const errors: string[] = [];
    const failedReqs: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror@${Math.round((Date.now() - t0) / 1000)}s: ${e.message}`));
    page.on("console", (m) => {
      // Transport noise the app absorbs by design (SW serves cache or the
      // import .catch() degrades): offline API fails, favicon, and chunk
      // loads refused under load — those reject honestly, never poison.
      if (m.type() === "error" && !/ERR_INTERNET_DISCONNECTED|ERR_FAILED|favicon|404/.test(m.text())) {
        errors.push(`console@${Math.round((Date.now() - t0) / 1000)}s: ${m.text().slice(0, 200)}`);
      }
    });
    page.on("requestfailed", (r) => {
      failedReqs.push(`${r.url().replace(/^https?:\/\/[^/]+/, "")} :: ${r.failure()?.errorText ?? ""}`);
    });
    page.on("response", (r) => {
      try {
        const u = r.url().replace(/^https?:\/\/[^/]+/, "");
        if (u.includes("10_on746g5udk")) {
          console.log(`CHUNK-STATUS: ${r.status()} ${u}`);
        }
        if (u.includes("/_next/static") && u.endsWith(".js")) {
          r.text().then((t) => {
            if (t.startsWith("<")) console.log("HTML-AS-JS:", u);
          }).catch(() => {});
        }
      } catch { /* ignore */ }
    });

    await login(page);
    for (const u of [`/ar/livreur/${SAT}/dashboard`, `/ar/livreur/${SUN}`, `/ar/livreur/${SUN}/dashboard`]) {
      await page.goto(u, { timeout: 20_000 });
      await page.waitForTimeout(700);
    }

    // Pair + full sync while online (zero-touch): seeds snapshot, credential
    // and chunks. The sync tile opens SyncModal.
    await page.goto(`/ar/livreur/${SAT}/dashboard`, { timeout: 20_000 });
    const syncTile = page.locator("button", { hasText: /مزامنة|Sync/ }).first();
    await syncTile.click();
    // Auto pair+sync runs on open; wait for the snapshot to land.
    await page.waitForTimeout(15000);
    await page.keyboard.press("Escape");
    await page.goto(`/ar/livreur/${SAT}/dashboard`, { timeout: 20_000 });
    // Van-side transfer approval is gone (admin-only): no tile, no modal.
    await expect(page.locator("body")).not.toContainText(/تحويلات/, { timeout: 10_000 });

    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 20_000 });
    await context.setOffline(true);

    // ── 1. Sunday client → collect 200 → queued ──
    // (name varies across runs — the edit test renames this client).
    await page.goto(`/ar/livreur/${SUN}`, { timeout: 20_000 });
    await page.locator("button", { hasText: /زبون تجريبي|معدل-/ }).first().click();
    await expect(page.locator('[role="dialog"]')).toContainText(/CLT-0001/, { timeout: 10_000 });
    await page.locator('[role="dialog"] input[type="number"]').fill("200");
    await page.locator('[role="dialog"] button', { hasText: /تحصيل|Collect/ }).last().click();
    await expect(page.locator('[role="dialog"]')).toContainText(/سيُزامَن|queued|⏳/, { timeout: 10_000 });

    console.log("FAILED-REQS:\n" + [...new Set(failedReqs)].slice(0, 30).join("\n"));
    expect(errors.filter((e) => !e.includes("favicon"))).toEqual([]);
    await context.setOffline(false);
  });
});
