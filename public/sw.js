/* ============================================================
   sw.js — Offline app-shell cache for the WeightLoss Tracker.

   Strategy: CACHE-FIRST for the static app shell (HTML/CSS/JS/manifest).
   • API calls (/api/*) and CDN helpers (/cdn-cgi/*) always go to the network.
   • Every served response refreshes the cache in the background.
   • Bump CACHE_VERSION to invalidate all cached copies after a deploy.
   ============================================================ */
const CACHE_VERSION = 'v3';
const CACHE_NAME = `wls-shell-${CACHE_VERSION}`;
const SKIP_PREFIXES = ['/api/', '/cdn-cgi/'];

const SHELL_ASSETS = [
  '/',
  '/css/styles.css',
  '/manifest.webmanifest',
  '/icon.svg',
  '/js/app.js',
  '/js/api.js',
  '/js/state.js',
  '/js/util.js',
  '/js/charts.js',
  '/js/offline.js',
  '/js/offline-math.js',
  '/js/sync.js',
  '/js/dashboard.js',
  '/js/foods.js',
  '/js/history.js',
  '/js/profile.js',
  '/js/steps.js',
];

self.addEventListener('install', (e) => {
  // Precache the app shell — one failing asset must NOT break the install
  // (allSettled never rejects), so the worker always activates.
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((a) => cache.add(a))))
      .then(() => self.skipWaiting())
  );
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

  e.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    // 1. Cache-first: serve the shell instantly, refresh it in the background.
    const cached = await cache.match(url.href, { ignoreSearch: url.pathname === '/' });
    if (cached) {
      e.waitUntil(
        fetch(e.request).then((res) => {
          if (res && res.ok) return cache.put(url.href, res.clone());
        }).catch(() => {})
      );
      return cached;
    }

    // 2. Offline navigation → always fall back to the cached app shell,
    //    so the app opens even if this exact path was never cached.
    if (e.request.mode === 'navigate') {
      const shell = await cache.match('/', { ignoreSearch: true });
      if (shell) return shell;
    }

    // 3. Not cached yet → network, then cache it for next time.
    try {
      const res = await fetch(e.request);
      if (res && res.ok) await cache.put(url.href, res.clone());
      return res;
    } catch (err) {
      // Last resort for any offline GET: the shell is better than an error page.
      const shell = await cache.match('/', { ignoreSearch: true });
      if (shell) return shell;
      throw err;
    }
  })());
});