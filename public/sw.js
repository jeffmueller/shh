/*
 * shh. service worker
 *
 * SECURITY: this app moves secrets, so the cache is opt-IN, never opt-out.
 * Only two classes of request are ever written to CacheStorage:
 *
 *   1. /_next/static/*  — build output, content-hash named and immutable
 *   2. /icons/*         — app icons
 *
 * Everything else goes to the network and its response is dropped on the
 * floor. In particular:
 *
 *   - /s/*, /created/*, /api/*  are hard-denied before any strategy runs, so
 *     a secret's ciphertext, plaintext or RSC payload can never be persisted
 *     to disk where it would outlive the secret's own expiry.
 *   - No navigation response is cached — not even "/" — so a page that
 *     rendered a secret can't be replayed from cache after it self-destructs.
 *   - Non-GET requests are never intercepted at all.
 *
 * Bump CACHE_VERSION to invalidate every cache on the next deploy.
 */

const CACHE_VERSION = "v1";
const CACHE_NAME = `shh-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline";

// Cached at install so there is always a valid offline response, which is also
// what makes the app installable.
const PRECACHE_REQUIRED = [OFFLINE_URL];
const PRECACHE_OPTIONAL = [
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-192.png",
  "/icons/maskable-512.png",
];

// Anything secret-bearing. Matched on pathname only, before any caching logic.
const SENSITIVE_PATH = /^\/(?:s|created|api)(?:\/|$)/;

// The only paths eligible for cache-first storage.
function isCacheableAsset(pathname) {
  return pathname.startsWith("/_next/static/") || pathname.startsWith("/icons/");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // The offline page is mandatory: if it fails, the install should fail
      // rather than leave a worker that can't answer offline.
      await cache.addAll(PRECACHE_REQUIRED);
      // Icons are best-effort; a single 404 shouldn't sink the install.
      await Promise.all(
        PRECACHE_OPTIONAL.map((url) => cache.add(url).catch(() => {}))
      );
      await precacheOfflineAssets(cache);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("shh-") && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only ever consider same-origin GETs. Everything else falls through to the
  // browser untouched.
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Secret-bearing routes: network only. Never read from cache, never write to
  // it. An offline failure falls back to the offline page so the user gets an
  // explanation instead of the browser's error page, but nothing is stored.
  if (SENSITIVE_PATH.test(url.pathname)) {
    if (request.mode === "navigate") {
      event.respondWith(networkOnlyWithOfflinePage(request));
    }
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkOnlyWithOfflinePage(request));
    return;
  }

  if (isCacheableAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Unclassified same-origin request: straight to the network, uncached.
});

// The offline page's stylesheet and chunks are content-hash named, so their
// URLs aren't knowable from a static file. Scrape them out of the offline
// HTML we just cached and precache them too — otherwise a client that goes
// offline before its second page load renders the offline page unstyled.
// Only /_next/static/ URLs are taken, which is the same allowlist cacheFirst
// enforces.
async function precacheOfflineAssets(cache) {
  try {
    const response = await cache.match(OFFLINE_URL);
    if (!response) return;
    const html = await response.text();
    const urls = new Set(html.match(/\/_next\/static\/[^"'\s>\\]+/g) ?? []);
    await Promise.all(
      [...urls].map((url) => cache.add(url).catch(() => {}))
    );
  } catch {
    // Best-effort only; never fail the install over it.
  }
}

// Navigations are always fetched fresh. The response is deliberately NOT
// cached, so no rendered page can be replayed later.
async function networkOnlyWithOfflinePage(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(CACHE_NAME);
    const offline = await cache.match(OFFLINE_URL);
    return (
      offline ??
      new Response("Offline.", {
        status: 503,
        headers: { "Content-Type": "text/plain" },
      })
    );
  }
}

// Safe only for immutable, content-hash-named build assets.
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  // status === 200 specifically: a 206 partial must never be stored as if it
  // were the whole asset.
  if (response.status === 200 && response.type === "basic") {
    cache.put(request, response.clone());
  }
  return response;
}
