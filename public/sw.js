/* Distribuili offline shell (v11).
 * Strategy: cache-first for Next static assets + uploads + fonts;
 * network-first for page documents (navigations AND explicit prefetches)
 * with cache fallback. Only clean, same-document HTML responses are stored
 * (never errors, redirects like the login redirect, or non-HTML) so a
 * poisoned entry can never serve a login form as a sale page offline.
 * Every branch below is wrapped so the worker ALWAYS answers with a
 * Response — the phone must never see the browser's dead error page.
 * The livreur journée loop pre-fetches its pages (exact URLs, query
 * included) while online so the whole flow keeps working fully offline.
 * Queued sales live in the outbox.
 * v10: purge the v9 page cache (a stale deploy cached HTML referencing a
 * rotated JS chunk → ChunkLoadError "This page couldn't load").
 * v11: purge EVERYTHING (a pre-v11 worker cached the HTML offline page
 * under chunk URLs on flaky networks — every later load SyntaxError'd and
 * the error-card reload looped forever). Plus a content-type guard below
 * so a mismatched body can never poison the static cache again.
 * v12: tunnel-down navigations (phone online, shop PC off) RESOLVE with
 * Cloudflare's 530 / Error 1033 page instead of rejecting — serve the
 * cache fallback for any 5xx document, or the driver sticks on the
 * Cloudflare error with a warm cache sitting unused. */
const VERSION = "dili-sw-v12";
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;
// One dashboard and login page per locale, outside the rolling page cache.
const RECOVERY_CACHE = "dili-offline-entry-v1";
const DASHBOARD = /^\/(ar|fr|en)\/livreur\/(\d{4})-(\d{1,2})-(\d{1,2})\/dashboard$/;
const LOGIN = /^\/(ar|fr|en)\/login$/;

function recoveryKey(url) {
  const dash = DASHBOARD.exec(url.pathname);
  if (dash) return new URL(`/${dash[1]}/livreur/offline-entry`, location.origin).href;
  if (LOGIN.test(url.pathname)) return new URL(url.pathname, location.origin).href;
  return null;
}

function dashboardDate(path) {
  const m = DASHBOARD.exec(path);
  return m ? Number(m[2]) * 10000 + Number(m[3]) * 100 + Number(m[4]) : 0;
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      // Only our own versioned shell caches are purged — the photo cache
      // (dili-img-v1) and any other store survive SW bumps.
      Promise.all(keys.filter((k) => k.startsWith("dili-sw-") && !k.startsWith(VERSION)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isCacheablePage(res) {
  if (!res || !res.ok || res.redirected) return false;
  try {
    return (res.headers.get("content-type") || "").includes("text/html");
  } catch {
    return false;
  }
}

/// Keep the page cache bounded: date-stamped journée URLs accumulate daily —
/// retain the 60 most recent, drop older days (re-fetched on next visit).
function trimPages() {
  caches.open(PAGE_CACHE).then((cache) =>
    cache.keys().then((keys) => {
      const days = keys
        .map((r) => r.url)
        .filter((u) => /\/livreur\/\d{4}-\d{1,2}-\d{1,2}/.test(u))
        .sort()
        .reverse();
      const stale = days.slice(60);
      if (stale.length) {
        stale.forEach((u) => cache.delete(u).catch(() => {}));
      }
      // Absolute backstop for everything else.
      if (keys.length > 400) {
        keys.slice(0, keys.length - 400).forEach((r) => cache.delete(r).catch(() => {}));
      }
    }).catch(() => {})
  ).catch(() => {});
}

async function putPage(req, res) {
  if (!isCacheablePage(res)) return;
  const url = new URL(req.url);
  url.hash = "";
  const key = url.href;
  const entry = url.search ? null : recoveryKey(url);
  const recoveryCopy = entry ? res.clone() : null;
  const writes = [caches.open(PAGE_CACHE).then(async (cache) => {
    await cache.put(key, res);
    trimPages();
  })];
  if (recoveryCopy) {
    writes.push(caches.open(RECOVERY_CACHE).then((cache) => cache.put(entry, recoveryCopy)));
  }
  await Promise.allSettled(writes);
}

async function newestCachedDashboard() {
  const keys = await (await caches.open(PAGE_CACHE)).keys();
  const urls = keys.map((key) => new URL(key.url))
    .filter((url) => url.origin === location.origin && !url.search && dashboardDate(url.pathname))
    .sort((a, b) => dashboardDate(b.pathname) - dashboardDate(a.pathname));
  for (const url of urls) {
    const hit = await caches.match(url.href);
    if (hit) return hit;
  }
  return null;
}

function openCachedDashboard(hit, requestedUrl) {
  const target = new URL(hit.url);
  if (target.origin !== requestedUrl.origin || !DASHBOARD.test(target.pathname)) return null;
  // Keep historical HTML on its original date and URL so its route and data agree.
  return target.pathname === requestedUrl.pathname ? hit : Response.redirect(target.href, 302);
}

async function offlineFallback(req) {
  try {
    const url = new URL(req.url);
    const exact = await caches.match(req);
    if (exact) return exact;
    const bare = url.origin + url.pathname;
    const withoutQuery = url.search ? await caches.match(bare) : null;
    if (withoutQuery) return withoutQuery;

    if (LOGIN.test(url.pathname)) {
      const login = await caches.match(bare, { cacheName: RECOVERY_CACHE });
      if (login) return login;
    }

    // A warmup fetch must never report a different page as a successful hit.
    if (req.mode === "navigate" && /^\/(ar|fr|en)\/livreur(?:\/|$)/.test(url.pathname)) {
      const locale = url.pathname.split("/")[1];
      const locales = [locale, ...["ar", "fr", "en"].filter((l) => l !== locale)];
      const now = new Date();
      const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
      for (const l of locales) {
        const hit = await caches.match(`/${l}/livreur/${day}/dashboard`);
        if (hit) {
          const response = openCachedDashboard(hit, url);
          if (response) return response;
        }
      }

      const entry = await caches.match(`/${locale}/livreur/offline-entry`, { cacheName: RECOVERY_CACHE });
      if (entry) {
        const response = openCachedDashboard(entry, url);
        if (response) return response;
      }
      // Existing installs already have dated pages from before the recovery cache.
      const previous = await newestCachedDashboard();
      if (previous) {
        const response = openCachedDashboard(previous, url);
        if (response) {
          const key = recoveryKey(new URL(previous.url));
          await caches.open(RECOVERY_CACHE).then((cache) => cache.put(key, previous.clone())).catch(() => {});
          return response;
        }
      }
      for (const l of locales.slice(1)) {
        const hit = await caches.match(`/${l}/livreur/offline-entry`, { cacheName: RECOVERY_CACHE });
        if (hit) {
          const response = openCachedDashboard(hit, url);
          if (response) return response;
        }
      }
      const days = await caches.match(`/${locale}/livreur`);
      if (days) return days;
    }
  } catch {
    // Browser storage can be unavailable or cleared.
  }
  return offlinePage();
}

function docResponse(event) {
  const req = event.request;
  try {
    return fetch(req).then(
      (res) => {
        // Phone online but server/tunnel down: Cloudflare answers the
        // navigation itself (HTTP 530 / Error 1033 page) so fetch
        // RESOLVES — without this check the driver sticks on the
        // Cloudflare error even with a warm cache. Any 5xx means
        // "server can't serve": work from cache instead. 4xx stays
        // served as-is (real app answers: unknown day, login…), and
        // 5xx is never cached (isCacheablePage needs res.ok), so the
        // error page can neither show nor poison the cache.
        let dead = false;
        try {
          dead = Number(res.status) >= 500;
        } catch {
          dead = false;
        }
        if (dead) return offlineFallback(req);
        // Clone SYNCHRONOUSLY here: once this callback returns, the
        // navigation starts consuming the body and any later clone throws
        // "body is already used" (that bug kept the whole page cache empty).
        let copy = null;
        try {
          copy = res.clone();
        } catch {
          copy = null;
        }
        try {
          if (copy) event.waitUntil(putPage(req, copy).catch(() => {}));
        } catch {
          /* serve anyway */
        }
        return res;
      },
      () => offlineFallback(req)
    ).catch(() => offlineFallback(req));
  } catch {
    return Promise.resolve(offlinePage());
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // API + live data: never intercepted (stale prices/stock break everything).
  if (url.pathname.startsWith("/api/")) return;

  // App shell assets: JS/CSS chunks, uploads, fonts, icons, manifest.
  // Cache-first, but NEVER synthesize the HTML offline page for these: an
  // HTML body served as a .js chunk parses as SyntaxError ("Unexpected
  // token '<'") and poisons the module graph far worse than a clean fetch
  // failure (every dynamic import in the app has a .catch that handles a
  // rejection honestly). Documents keep the offline-page fallback below —
  // assets reject so callers degrade.
  // Content-type guard: only cache a body matching its URL (.js needs
  // javascript, .css needs css). A mismatched body is still SERVED, just
  // never stored — so a fallback page can never poison the cache again.
  if (url.pathname.startsWith("/_next/static") || url.pathname.startsWith("/uploads") || url.pathname.startsWith("/fonts") || url.pathname.startsWith("/icons") || url.pathname === "/manifest.webmanifest" || url.pathname === "/favicon.ico" || url.pathname === "/apple-touch-icon.png") {    try {
      event.respondWith(
        caches.open(STATIC_CACHE).then((cache) =>
          cache.match(req).then((hit) => hit ?? fetch(req).then((res) => {
            try {
              // A missing asset must not discard every saved driver screen.
              // Network-first documents replace old HTML on the next online visit.
              if (res.status === 404) return res;
              const ct = (res.headers.get("content-type") || "").toLowerCase();
              const p = url.pathname.toLowerCase();
              const okType =
                (p.endsWith(".js") && ct.includes("javascript")) ||
                (p.endsWith(".css") && ct.includes("css")) ||
                (!p.endsWith(".js") && !p.endsWith(".css"));
              if (res.ok && okType) cache.put(req, res.clone());
            } catch {
              /* serve anyway, just don't cache */
            }
            return res;
          }))
        ).catch(() => fetch(req))
      );
    } catch {
      /* let the network handle it */
    }
    return;
  }

  if (req.mode === "navigate") {
    try {
      event.respondWith(docResponse(event));
    } catch {
      try {
        event.respondWith(Promise.resolve(offlinePage()));
      } catch {
        /* unreachable */
      }
    }
    return;
  }

  // Explicit prefetch of page documents (the journée loop warms its pages
  // while online). Same network-first + cache behavior as navigations.
  let accept = "";
  try {
    accept = req.headers.get("accept") || "";
  } catch {
    accept = "";
  }
  if (req.method === "GET" && accept.includes("text/html")) {
    try {
      event.respondWith(docResponse(event));
    } catch {
      /* prefetch must never break the page */
    }
  }
});

function offlinePage() {
  return new Response(
    `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>غير متصل</title></head>` +
    `<body style="font-family:system-ui;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#070708;color:#e2e8f0;margin:0">` +
    `<div style="text-align:center;padding:24px"><div style="font-size:44px">📴</div>` +
    `<h1>لا يوجد اتصال</h1><p>افتح هذه الصفحة مرة واحدة وأنت متصل لتتوفر دون إنترنت.</p>` +
    `<button onclick="location.reload()" style="padding:12px 28px;border:0;border-radius:10px;background:#0d59a3;color:#fff;font-size:16px;font-weight:800">إعادة المحاولة</button>` +
    `</div></body></html>`,
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}
