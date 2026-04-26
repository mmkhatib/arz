/* Arz dashboard service worker — minimal app-shell cache.
 *
 * Strategy:
 *  - Cache the navigation shell + immutable hashed bundles on first request.
 *  - Network-first for navigation requests; fall back to cached shell when offline.
 *  - Network-first for /api/*, never cache (responses are session-state).
 *  - Cache-first for static assets under /assets/ (Vite's hashed output).
 */

const CACHE_NAME = "arz-shell-v1";
const SHELL_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(SHELL_URL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Never cache API or SSE traffic — always live.
  if (url.pathname.startsWith("/api/")) return;

  // Cache-first for hashed asset bundles.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (res.ok) {
              const clone = res.clone();
              caches.open(CACHE_NAME).then((c) => c.put(req, clone));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Navigation requests: network-first, fall back to shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(SHELL_URL, clone));
          }
          return res;
        })
        .catch(() => caches.match(SHELL_URL)),
    );
  }
});
