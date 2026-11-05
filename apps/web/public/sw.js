/* global self, caches */
// Klik Go service worker (docs/BUILD_PLAN.md Phase 4 "PWA"). Hand-written and dependency-free:
// - app shell: static build assets are cache-first (their URLs are content-hashed);
// - pages: network-first, falling back to the last copy, then to /offline;
// - home feed API: network-first with the last answer as the offline fallback.
// Never caches auth, cart pricing, merchant or admin traffic.
const VERSION = "klikgo-v1";
const SHELL = ["/offline", "/brand/icon-192.png", "/brand/icon-512.png", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

const PRIVATE =
  /^\/(api\/(auth|cart|admin|merchant|hooks|me|addresses)|auth|merchant|admin|rider)(\/|$)/;

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(VERSION);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallbackUrl) return (await cache.match(fallbackUrl)) ?? Response.error();
    return Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || PRIVATE.test(url.pathname)) return;
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/brand/")) {
    event.respondWith(cacheFirst(request));
  } else if (url.pathname === "/api/feed") {
    event.respondWith(networkFirst(request, null));
  } else if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "/offline"));
  }
});
