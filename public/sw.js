/* ============================================================
   sw.js — Offline app-shell cache for the WeightLoss Tracker.

   Strategy: CACHE-FIRST for the static app shell (HTML/CSS/JS/manifest).
   • API calls (/api/*) and CDN helpers (/cdn-cgi/*) always go to the network.
   • Every served response refreshes the cache in the background.
   • Bump CACHE_VERSION to invalidate all cached copies after a deploy.
   ============================================================ */
const CACHE_VERSION = 'v1';
const CACHE_NAME = `wls-shell-${CACHE_VERSION}`;
const SKIP_PREFIXES = ['/api/', '/cdn-cgi/'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll?.([])));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients?.claim?.())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.origin) return;
  if (SKIP_PREFIXES.some((p) => url.pathname.startsWith(p))) return; // never cache API
  if (url.pathname.endsWith('/sw.js')) return; // the SW itself must always be fresh

  e.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: url.pathname === '/' });
      const refresh = fetch(e.request).then((res) => {
        if (res.ok && (res.type === 'basic' || res.type === 'default')) {
          cache.put(e.request, res.clone());
        }
        return res;
      }).catch(() => cached);
      return cached || refresh;
    })
  );
});