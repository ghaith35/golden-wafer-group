/* Distribuili offline shell (v1).
 * Strategy: cache-first for Next static assets + uploads; network-first for
 * navigations/API with cache fallback. Queued sales live in localStorage
 * (outbox) and survive offline — the SW only keeps the shell loadable. */
const VERSION = "dili-sw-v4";
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // API + live data: never intercepted (stale prices/stock break everything).
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static") || url.pathname.startsWith("/uploads")) {    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) =>
        cache.match(req).then((hit) => hit ?? fetch(req).then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        }))
      )
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(PAGE_CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit ?? caches.match("/ar/dashboard")))
    );
  }
});
