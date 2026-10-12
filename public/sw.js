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
 * so a mismatched body can never poison the static cache again. */
const VERSION = "dili-sw-v11";
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;

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

function putPage(req, res) {
  if (!isCacheablePage(res)) return;
  // Store under the plain URL string: navigation Request objects carry
  // mode/redirect semantics that make Cache.put silently refuse them.
  // NOTE: res must already be a detached clone — callers clone synchronously
  // inside fetch's .then (see docResponse). Cloning later (e.g. inside
  // caches.open().then) races the navigation's body lock and fails with
  // "Response body is already used", leaving the cache forever empty.
  const key = String(req.url).split("#")[0];
  caches.open(PAGE_CACHE).then((cache) => {
    cache.put(key, res).catch(() => {});
    trimPages();
  }).catch(() => {});
}

/// Offline fallback chain for a document: exact URL → same path without
/// query (e.g. dashboard?client=X falls back to the dashboard shell, the
/// driver re-picks the client) → today's dashboard (the journée entry
/// /livreur is an uncached server redirect, so a cold offline start must
/// land here, not on the days shell) → days shell → friendly offline page.
/// Plain string keys only (no Request construction) and fully guarded:
/// this function never throws, so respondWith always has a Response.
function offlineFallback(req) {
  let bareUrl = null;
  try {
    bareUrl = String(req.url).split("?")[0];
  } catch {
    bareUrl = null;
  }
  const matchDays = () => {
    try {
      return caches.match("/ar/livreur").then((days) => days ?? offlinePage());
    } catch {
      return Promise.resolve(offlinePage());
    }
  };
  // Today's dashboard in any locale: warmed on every journée visit, fully
  // usable offline (snapshot + outbox + its own start/finish stamps).
  // Served as a REDIRECT (not content): the app shell derives chrome
  // visibility from the URL path, so serving dashboard HTML under /livreur
  // hydrates mismatched (React #418) and hides the sidebar. The follow-up
  // navigation is an exact cache hit — one invisible local hop.
  // The original query (?device=…) is preserved across the hop.
  const matchTodayDash = (reqUrl) => {
    let search = "";
    try {
      search = new URL(String(reqUrl)).search || "";
    } catch {
      search = "";
    }
    try {
      const d = new Date();
      const slug = d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
      const locales = ["ar", "fr", "en"];
      let chain = Promise.resolve(null);
      locales.forEach((l) => {
        chain = chain.then((hit) => {
          if (hit) return hit;
          try {
            return caches.match("/" + l + "/livreur/" + slug + "/dashboard").catch(() => null);
          } catch {
            return Promise.resolve(null);
          }
        });
      });
      return chain.then((hit) => {
        if (hit) {
          try {
            const hitPath = new URL(hit.url).pathname;
            const reqPath = new URL(String(reqUrl)).pathname;
            if (hitPath !== reqPath) return Response.redirect(hitPath + search, 302);
          } catch {
            /* fall through and serve */
          }
          return hit;
        }
        return matchDays();
      }).catch(() => {
        try {
          return matchDays();
        } catch {
          return Promise.resolve(offlinePage());
        }
      });
    } catch {
      try {
        return matchDays();
      } catch {
        return Promise.resolve(offlinePage());
      }
    }
  };
  try {
    return caches.match(req).then((hit) => {
      if (hit) return hit;
      if (bareUrl) {
        try {
          return caches.match(bareUrl).then((bare) => bare ?? matchTodayDash(req.url));
        } catch {
          return matchTodayDash(req.url);
        }
      }
      return matchTodayDash(req.url);
    }).catch(() => {
      try {
        return matchTodayDash(req.url);
      } catch {
        return Promise.resolve(offlinePage());
      }
    });
  } catch {
    try {
      return Promise.resolve(offlinePage());
    } catch {
      return Promise.resolve(new Response("offline", { status: 503 }));
    }
  }
}

function docResponse(req) {
  try {
    return fetch(req).then(
      (res) => {
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
          if (copy) putPage(req, copy);
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
              // Rotated chunk: the cached page predates a deploy and the
              // server only keeps the current build. Drop the page cache so
              // the NEXT navigation fetches fresh HTML instead of replaying
              // the dead page (one bad load, then self-healed — served as-is
              // this time so callers see a normal 404, never HTML-as-JS).
              if (res.status === 404) {
                caches.delete(PAGE_CACHE).catch(() => {});
                return res;
              }
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
      event.respondWith(docResponse(req));
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
      event.respondWith(docResponse(req));
    } catch {
      /* prefetch must never break the page */
    }
  }
});

function offlinePage() {
  return new Response(
    `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>غير متصل</title></head>` +
    `<body style="font-family:system-ui;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#0f172a;color:#e2e8f0;margin:0">` +
    `<div style="text-align:center;padding:24px"><div style="font-size:44px">📴</div>` +
    `<h1>لا يوجد اتصال</h1><p>افتح هذه الصفحة مرة واحدة وأنت متصل لتتوفر دون إنترنت.</p>` +
    `<button onclick="location.reload()" style="padding:12px 28px;border:0;border-radius:10px;background:#65a30d;color:#fff;font-size:16px;font-weight:800">إعادة المحاولة</button>` +
    `</div></body></html>`,
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}
