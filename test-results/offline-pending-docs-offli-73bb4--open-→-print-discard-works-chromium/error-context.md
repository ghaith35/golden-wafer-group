# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: offline-pending-docs.spec.ts >> offline pending docs (ticket + order) >> queue offline → visible → open → print, discard works
- Location: tests/e2e/offline-pending-docs.spec.ts:26:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('dialog')
Expected: visible
Error: strict mode violation: getByRole('dialog') resolved to 2 elements:
    1) <div role="dialog" aria-label="…" aria-modal="true" class="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-3 backdrop-blur-sm md:items-center md:p-5">…</div> aka getByRole('dialog', { name: '…' })
    2) <div role="dialog" aria-modal="true" aria-label="Aperçu facture" class="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-3 backdrop-blur-sm md:items-center md:p-5">…</div> aka getByRole('dialog', { name: 'Aperçu facture' })

Call log:
  - Expect "toBeVisible" getByRole('dialog') with timeout 10000ms
  - waiting for getByRole('dialog')

```

# Page snapshot

```yaml
- generic [ref=f10e1]:
  - generic [ref=f10e3]:
    - banner [ref=f10e4]:
      - button "القائمة" [ref=f10e5]
      - generic [ref=f10e7]: بيع الشاحنة
      - button "● غير متصل · 1" [ref=f10e9]
      - button "Dark mode" [ref=f10e11]
      - button "تسجيل الخروج" [ref=f10e15]
    - main [ref=f10e22]:
      - generic [ref=f10e23]:
        - generic [ref=f10e24]:
          - button "back" [ref=f10e25]
          - heading "الفواتير (9)" [level=1] [ref=f10e28]
        - generic [ref=f10e29]:
          - generic [ref=f10e30]:
            - generic [ref=f10e31]:
              - generic [ref=f10e32]: … ·
              - generic [ref=f10e33]:
                - generic [ref=f10e34]: 12‏/10‏/2026 · 06:14 م · ⁦320 DA⁩
                - generic [ref=f10e35]: غير متزامن
            - button "عرض" [active] [ref=f10e43]
            - button "اطبع" [ref=f10e44]
            - button "حذف" [ref=f10e49]
          - generic [ref=f10e53]:
            - generic [ref=f10e54]:
              - generic [ref=f10e55]: TCK-0008 · زبون تجريبي — الأحد
              - generic [ref=f10e56]: 12‏/10‏/2026 · 06:04 م · ⁦5 400 DA⁩
            - button "عرض" [ref=f10e58]
            - button "تعديل" [disabled] [ref=f10e59]: ✎
            - button "اطبع" [ref=f10e60]
            - button "حذف" [ref=f10e65]
          - generic [ref=f10e69]:
            - generic [ref=f10e70]:
              - generic [ref=f10e71]: TCK-0007 · زبون تجريبي — الأحد
              - generic [ref=f10e72]: 12‏/10‏/2026 · 05:41 م · ⁦750 DA⁩
            - button "عرض" [ref=f10e74]
            - button "تعديل" [disabled] [ref=f10e75]: ✎
            - button "اطبع" [ref=f10e76]
            - button "حذف" [ref=f10e81]
          - generic [ref=f10e85]:
            - generic [ref=f10e86]:
              - generic [ref=f10e87]: TCK-0006 · زبون تجريبي — الأحد
              - generic [ref=f10e88]: 12‏/10‏/2026 · 05:39 م · ⁦450 DA⁩
            - button "عرض" [ref=f10e90]
            - button "تعديل" [disabled] [ref=f10e91]: ✎
            - button "اطبع" [ref=f10e92]
            - button "حذف" [ref=f10e97]
          - generic [ref=f10e101]:
            - generic [ref=f10e102]:
              - generic [ref=f10e103]: TCK-0005 · زبون تجريبي — الأحد
              - generic [ref=f10e104]: 12‏/10‏/2026 · 05:03 م · ⁦140 DA⁩
            - button "عرض" [ref=f10e106]
            - button "تعديل" [disabled] [ref=f10e107]: ✎
            - button "اطبع" [ref=f10e108]
            - button "حذف" [ref=f10e113]
          - generic [ref=f10e117]:
            - generic [ref=f10e118]:
              - generic [ref=f10e119]: TCK-0004 · زبون تجريبي — الأحد
              - generic [ref=f10e120]: 12‏/10‏/2026 · 04:52 م · ⁦750 DA⁩
            - button "عرض" [ref=f10e122]
            - button "تعديل" [disabled] [ref=f10e123]: ✎
            - button "اطبع" [ref=f10e124]
            - button "حذف" [ref=f10e129]
          - generic [ref=f10e133]:
            - generic [ref=f10e134]:
              - generic [ref=f10e135]: TCK-0003 · زبون تجريبي — الأحد
              - generic [ref=f10e136]: 12‏/10‏/2026 · 04:51 م · ⁦450 DA⁩
            - button "عرض" [ref=f10e138]
            - button "تعديل" [disabled] [ref=f10e139]: ✎
            - button "اطبع" [ref=f10e140]
            - button "حذف" [ref=f10e145]
          - generic [ref=f10e149]:
            - generic [ref=f10e150]:
              - generic [ref=f10e151]: TCK-0002 · زبون تجريبي — الأحد
              - generic [ref=f10e152]: 12‏/10‏/2026 · 02:47 م · ⁦750 DA⁩
            - button "عرض" [ref=f10e154]
            - button "تعديل" [disabled] [ref=f10e155]: ✎
            - button "اطبع" [ref=f10e156]
            - button "حذف" [ref=f10e161]
          - generic [ref=f10e165]:
            - generic [ref=f10e166]:
              - generic [ref=f10e167]: TCK-0001 · زبون تجريبي — الأحد
              - generic [ref=f10e168]: 12‏/10‏/2026 · 02:47 م · ⁦750 DA⁩
            - button "عرض" [ref=f10e170]
            - button "تعديل" [disabled] [ref=f10e171]: ✎
            - button "اطبع" [ref=f10e172]
            - button "حذف" [ref=f10e177]
        - dialog "…" [ref=f10e181]:
          - generic [ref=f10e182]:
            - generic [ref=f10e185]:
              - generic [ref=f10e191]:
                - heading "…" [level=2] [ref=f10e192]
                - paragraph [ref=f10e193]: …
              - button "Close" [ref=f10e194]
            - generic [ref=f10e199]:
              - generic [ref=f10e200]:
                - generic [ref=f10e201]:
                  - generic [ref=f10e202]: …
                  - generic [ref=f10e203]: ⁦1 DA⁩ × ⁦150 DA⁩
                  - generic [ref=f10e204]: ⁦150 DA⁩
                - generic [ref=f10e205]:
                  - generic [ref=f10e206]: …
                  - generic [ref=f10e207]: ⁦1 DA⁩ × ⁦170 DA⁩
                  - generic [ref=f10e208]: ⁦170 DA⁩
              - generic [ref=f10e209]:
                - generic [ref=f10e210]: المجموع
                - generic [ref=f10e211]: ⁦320 DA⁩
              - generic [ref=f10e212]:
                - generic [ref=f10e213]: المقبوض
                - generic [ref=f10e214]: ⁦320 DA⁩
              - generic [ref=f10e215]:
                - button "إلغاء" [ref=f10e216]
                - button "اطبع" [ref=f10e217]
    - navigation [ref=f10e222]:
      - button "بيع الشاحنة" [ref=f10e223]
  - alert [ref=f10e227]
  - generic [ref=f10e229]:
    - generic [ref=f10e232]:
      - generic [ref=f10e234]:
        - generic [ref=f10e235]: N° …
        - generic [ref=f10e236]: 12‏/10‏/2026 · 06:14 م
      - generic [ref=f10e237]: "Client: …"
      - generic [ref=f10e240]:
        - generic [ref=f10e241]: Produit
        - generic [ref=f10e242]: Prix pièce
        - generic [ref=f10e243]: Qté
        - generic [ref=f10e244]: Prix
        - generic [ref=f10e245]: Total
        - generic [ref=f10e246]: …
        - generic [ref=f10e247]: —
        - generic [ref=f10e248]: ⁦1⁩
        - generic [ref=f10e249]: ⁦150 DA⁩
        - generic [ref=f10e250]: ⁦150 DA⁩
        - generic [ref=f10e251]: …
        - generic [ref=f10e252]: —
        - generic [ref=f10e253]: ⁦1⁩
        - generic [ref=f10e254]: ⁦170 DA⁩
        - generic [ref=f10e255]: ⁦170 DA⁩
      - generic [ref=f10e257]:
        - generic [ref=f10e258]: Total
        - generic [ref=f10e259]: ⁦320 DA⁩
      - generic [ref=f10e260]:
        - generic [ref=f10e261]: Payé
        - generic [ref=f10e262]: ⁦320 DA⁩
      - generic [ref=f10e263]:
        - generic [ref=f10e264]: Reste
        - generic [ref=f10e265]: ⁦0 DA⁩
      - generic [ref=f10e267]: Merci
    - generic [ref=f10e268]:
      - button "إلغاء" [ref=f10e269]
      - button "Partager" [ref=f10e273]
      - button "اطبع" [ref=f10e279]
    - dialog "Aperçu facture" [ref=f10e284]:
      - generic [ref=f10e285]:
        - generic [ref=f10e288]:
          - generic [ref=f10e289]: 🧾
          - generic [ref=f10e290]:
            - heading "Aperçu facture" [level=2] [ref=f10e291]
            - paragraph [ref=f10e292]: N° …
          - button "Close" [ref=f10e293]
        - generic [ref=f10e298]:
          - generic [ref=f10e300]:
            - generic [ref=f10e302]:
              - generic [ref=f10e303]: N° …
              - generic [ref=f10e304]: …
            - table [ref=f10e305]:
              - rowgroup [ref=f10e306]:
                - row [ref=f10e307]:
                  - cell "…" [ref=f10e308]
                  - cell "1 × 150" [ref=f10e309]
                  - cell "150" [ref=f10e310]
                - row [ref=f10e311]:
                  - cell "…" [ref=f10e312]
                  - cell "1 × 170" [ref=f10e313]
                  - cell "170" [ref=f10e314]
            - generic [ref=f10e316]:
              - generic [ref=f10e317]:
                - generic [ref=f10e318]: Total
                - generic [ref=f10e319]: "320"
              - generic [ref=f10e320]:
                - generic [ref=f10e321]: Payé
                - generic [ref=f10e322]: "320"
              - generic [ref=f10e323]:
                - generic [ref=f10e324]: Reste
                - generic [ref=f10e325]: "0"
            - generic [ref=f10e326]: Merci
          - generic [ref=f10e327]:
            - button "close" [ref=f10e328]
            - button "حفظ" [ref=f10e332]
            - button "Partager" [ref=f10e333]
```

# Test source

```ts
  8   | // (server: DISTRIBUILI_DB=local DISTRIBUILI_SQLITE_URL=file:/tmp/e2e-test.db next start)
  9   | 
  10  | const USER = process.env.E2E_USER ?? "ghaith";
  11  | const PASS = process.env.E2E_PASS ?? "test1234";
  12  | const DAY = "2026-10-11";
  13  | const CLIENT = "cmv4duzwp0002w5e70ecc4tsq"; // CLT-0001 in the throwaway DB
  14  | 
  15  | async function login(page: Page) {
  16  |   await page.goto("/ar/login");
  17  |   await page.locator("#login-username").fill(USER);
  18  |   await page.locator("#login-password").fill(PASS);
  19  |   await page.locator('form button[type="submit"]').click();
  20  |   await page.waitForURL(/\/ar\/livreur/, { timeout: 20_000 });
  21  | }
  22  | 
  23  | test.describe("offline pending docs (ticket + order)", () => {
  24  |   test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  25  | 
  26  |   test("queue offline → visible → open → print, discard works", async ({ page, context }) => {
  27  |     const errors: string[] = [];
  28  |     page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  29  |     // Transport noise the app absorbs by design (SW serves cache or the
  30  |     // import .catch() degrades): offline fails + chunk loads refused under
  31  |     // load, which reject honestly and never poison the module graph.
  32  |     page.on("console", (m) => {
  33  |       if (m.type() === "error" && !/ERR_INTERNET_DISCONNECTED|ERR_FAILED|favicon|404/.test(m.text())) {
  34  |         errors.push(`console: ${m.text().slice(0, 200)}`);
  35  |       }
  36  |     });
  37  | 
  38  |     await login(page);
  39  | 
  40  |     // Warm every page + query variant while online (SW cache + SSR props).
  41  |     for (const u of [
  42  |       `/ar/livreur/${DAY}/dashboard`,
  43  |       `/ar/livreur/${DAY}`,
  44  |       `/ar/livreur/${DAY}/vente?client=${CLIENT}`,
  45  |       `/ar/livreur/${DAY}/commande?client=${CLIENT}`,
  46  |       `/ar/livreur/${DAY}/factures`,
  47  |       `/ar/livreur/${DAY}/commandes`,
  48  |     ]) {
  49  |       await page.goto(u, { timeout: 20_000 });
  50  |       await page.waitForTimeout(700);
  51  |     }
  52  |     await page.reload();
  53  |     await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 20_000 });
  54  | 
  55  |     await context.setOffline(true);
  56  | 
  57  |     // ── 1. Mixed-tier sale offline → queued + preview ──
  58  |     // Line 1 at base sell (150), toggle Gros, line 2 at Gros (170).
  59  |     // Toggling never rewrites line 1; products without a Gros price
  60  |     // would keep base (both fixtures have one).
  61  |     await page.goto(`/ar/livreur/${DAY}/vente?client=${CLIENT}`, { timeout: 20_000 });
  62  |     await page.locator('[role="button"]', { hasText: "منتج تجريبي" }).first().click();
  63  |     await page.getByTestId("qty-confirm").click();
  64  |     await page.locator("button", { hasText: /^Gros$/ }).first().click();
  65  |     await expect(page.locator("body")).toContainText(/130/, { timeout: 10_000 });
  66  |     await page.locator('[role="button"]', { hasText: "منتج ثاني" }).first().click();
  67  |     await page.getByTestId("qty-confirm").click();
  68  |     await page.locator("button.fixed.inset-x-0").first().click();
  69  |     // Recap: line 1 kept base (badge سعر البيع), line 2 Gros, total 320.
  70  |     await expect(page.locator("body")).toContainText(/سعر البيع|Prix de vente|Sell price/, { timeout: 10_000 });
  71  |     await expect(page.locator("body")).toContainText(/Gros/, { timeout: 10_000 });
  72  |     // Each line has its own delete button (no more qty-to-zero dance).
  73  |     await expect(page.getByRole("button", { name: /إزالة|Remove|Retirer/ })).toHaveCount(2);
  74  |     await page.getByTestId("confirm-sale").click();
  75  |     // Preview renders from the local snapshot (number assigned on sync).
  76  |     await expect(page.locator("body")).toContainText(/320/, { timeout: 10_000 });
  77  | 
  78  |     // ── 2. Factures shows the pending ticket, opens, prints ──
  79  |     // (the pending row itself PROVES the outbox write — same store the
  80  |     // phone reads; desktop Chrome persists it via IndexedDB, not localStorage)
  81  |     await page.goto(`/ar/livreur/${DAY}/factures`, { timeout: 20_000 });
  82  |     await expect(page.locator("body")).toContainText(/غير متزامن|Non synchronisé|Unsynced|بانتظار المزامنة|⏳/, { timeout: 10_000 });
  83  |     await page.getByTestId("view-doc").first().click();
  84  |     await expect(page.locator('[role="dialog"]')).toContainText(/منتج تجريبي|…/, { timeout: 10_000 });
  85  |     await page.getByTestId("pv-print").click();
  86  |     await expect(page.locator("body")).toContainText(/320/, { timeout: 10_000 });
  87  |     // Share → in-app A4 viewer (same content as the PDF) → share → download.
  88  |     await page.getByTestId("pv-share").click();
  89  |     const viewer = page.getByRole("dialog", { name: "Aperçu facture" });
  90  |     await expect(viewer).toContainText(/320/, { timeout: 10_000 });
  91  |     const dl = await Promise.all([
  92  |       page.waitForEvent("download", { timeout: 15_000 }),
  93  |       page.getByTestId("pv-share-confirm").click(),
  94  |     ]).then(([d]) => d);
  95  |     expect(dl.suggestedFilename()).toMatch(/\.pdf$/);
  96  |     // Share feedback inside the viewer (saved ✓ on desktop Chromium).
  97  |     await expect(viewer).toContainText(/✓/, { timeout: 10_000 });
  98  |     // Close everything (viewer + print preview + detail may stack).
  99  |     await page.keyboard.press("Escape");
  100 |     await page.waitForTimeout(500);
  101 |     await page.keyboard.press("Escape");
  102 |     await page.waitForTimeout(500);
  103 |     await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 10_000 });
  104 |     // Reopen the facture detail: edit stays disabled for pending docs
  105 |     // (no server id to edit).
  106 |     await page.getByTestId("view-doc").first().click();
  107 |     const detail = page.getByRole("dialog");
> 108 |     await expect(detail).toBeVisible({ timeout: 10_000 });
      |                          ^ Error: expect(locator).toBeVisible() failed
  109 |     await expect(detail.getByRole("button", { name: /تعديل|Edit|Modifier/ })).toBeDisabled({ timeout: 10_000 });
  110 |     await page.keyboard.press("Escape");
  111 | 
  112 |     // ── 3. Order offline → queued → visible as DRAFT ──
  113 |     await page.goto(`/ar/livreur/${DAY}/commande?client=${CLIENT}`, { timeout: 20_000 });
  114 |     await page.locator('[role="button"]', { hasText: "منتج تجريبي" }).first().click();
  115 |     await page.getByTestId("qty-confirm").click();
  116 |     await page.locator("button.fixed.inset-x-0").first().click();
  117 |     await page.getByTestId("send-order").click();
  118 |     await page.waitForTimeout(1000);
  119 |     await page.goto(`/ar/livreur/${DAY}/commandes`, { timeout: 20_000 });
  120 |     await expect(page.locator("body")).toContainText(/غير متزامن|Non synchronisé|Unsynced|DRAFT|…/, { timeout: 10_000 });
  121 |     await page.getByTestId("view-doc").first().click();
  122 |     await expect(page.locator('[role="dialog"]')).toContainText(/منتج تجريبي|…/, { timeout: 10_000 });
  123 | 
  124 |     // ── 4. Discard the pending ticket → gone from the list ──
  125 |     await page.goto(`/ar/livreur/${DAY}/factures`, { timeout: 20_000 });
  126 |     const before = await page.getByTestId("view-doc").count();
  127 |     await page.getByTestId("delete-doc").first().click();
  128 |     await page.getByRole("button", { name: /نعم|oui|yes/i }).click();
  129 |     await expect(page.locator("body")).toContainText(/حُذف من الهاتف|Supprimé|Deleted/, { timeout: 10_000 });
  130 |     await expect.poll(async () => page.getByTestId("view-doc").count(), { timeout: 10_000 }).toBe(before - 1);
  131 | 
  132 |     expect(errors.filter((e) => !e.includes("favicon"))).toEqual([]);
  133 |     await context.setOffline(false);
  134 |   });
  135 | });
  136 | 
```