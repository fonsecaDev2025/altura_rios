/**
 * Service Worker: shell offline + network-first para /api públicas.
 */
const CACHE_SHELL = "altura-rios-shell-v3";
const CACHE_API = "altura-rios-api-v3";
// No precachear HTML: siempre red para evitar páginas/JS desfasados tras deploy.
const SHELL = [
  "/styles.css",
  "/ui.js",
  "/nav.js",
  "/fonts.js",
  "/config.js",
  "/api-resolve.js",
  "/manifest.webmanifest",
  "/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_SHELL)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn("[sw] install", err))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_SHELL && k !== CACHE_API)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

function isApiGet(url) {
  return (
    url.origin === self.location.origin &&
    url.pathname.startsWith("/api/") &&
    !url.pathname.startsWith("/api/auth") &&
    !url.pathname.startsWith("/api/pasos") &&
    !url.pathname.startsWith("/api/cron") &&
    !url.searchParams.has("refresh")
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (isApiGet(url)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_API).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || Response.error()))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // JS/CSS/HTML: red primero para evitar mezclar versiones tras deploy.
  const isAsset =
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".html") ||
    url.pathname === "/";

  if (isAsset) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_SHELL).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || Response.error()))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).catch(() => Response.error()))
  );
});
