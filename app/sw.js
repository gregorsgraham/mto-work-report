// MTO Work Report — service worker
//
// Strategy:
//   - HTML (index.html and navigation requests): NETWORK-FIRST. Always try
//     to fetch fresh from the network; fall back to cache only if offline.
//     This is the fix for "iOS PWA stuck on stale HTML" — the network is
//     consulted on every visit, so a deploy is picked up on next page load.
//   - Other same-origin assets (icons, manifest): CACHE-FIRST. Once cached,
//     serve from cache; updated assets are picked up next time the cache
//     name changes. Bump CACHE_VERSION when you ship new icons or manifest.
//
// On install, we precache the shell so the app works offline. On activate,
// old caches are deleted. The SW listens for SKIP_WAITING messages so the
// page can promote a new SW immediately after install.

const CACHE_VERSION = 'mto-v191';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './physicalworkreportform.pdf'
];

// Third-party libraries the app cannot function without, even though they're
// loaded from a CDN. Previously only Leaflet (via RUNTIME_CDN_HOSTS below)
// got cached, and only AFTER first being requested — meaning JSZip (ZIP
// backup/restore) and pdf-lib (the official MTO PDF generator, the whole
// point of the app) were relying entirely on the browser's ordinary HTTP
// cache, which is not reliable offline (especially on iOS, where it isn't
// covered by navigator.storage.persist() the way Cache Storage is). We now
// fetch and store all of these into Cache Storage right on install, so
// they're guaranteed available offline from the very first successful load
// — not just after the user happens to trigger that feature once online.
const CDN_PRECACHE = [
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => Promise.all([
      // Same-origin shell: addAll is atomic (all-or-nothing), so keep it
      // isolated from the CDN fetches below — a flaky CDN shouldn't be able
      // to sink caching of the app's own HTML/icons.
      cache.addAll(SHELL).catch(() => {}),
      // Cross-origin libraries: fetch individually so one failure (e.g. a
      // CDN hiccup during install) doesn't block the others.
      ...CDN_PRECACHE.map(url =>
        fetch(url, { mode: 'cors' })
          .then(resp => { if (resp && resp.ok) return cache.put(url, resp); })
          .catch(() => {})
      )
    ]))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Cross-origin hosts we want to cache aggressively for offline field use:
// Leaflet (unpkg) for the GPS-tab map, JSZip (cdnjs) for ZIP backup/restore,
// and pdf-lib (jsdelivr) for generating the official MTO PDF. All three are
// also proactively precached on install above — this whitelist is what lets
// the SW keep serving them from cache (and silently refresh the cached copy
// in the background) on every later load too. Map tiles are handled
// separately via IndexedDB (precacheBoundaryTilesForReport in index.html).
const RUNTIME_CDN_HOSTS = ['unpkg.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];

self.addEventListener('fetch', event => {
  const req = event.request;
  // Only handle GETs.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Cross-origin: cache-first for whitelisted CDN assets so Leaflet
  // is available with no internet. Everything else cross-origin (tile
  // servers, BC OpenMaps WFS, etc.) is left alone — those have their
  // own caching paths in the app.
  if (url.origin !== self.location.origin) {
    if (RUNTIME_CDN_HOSTS.some(h => url.hostname.endsWith(h))) {
      event.respondWith(
        caches.match(req).then(cached => {
          if (cached) return cached;
          return fetch(req).then(resp => {
            // Only cache successful, basic/cors responses — opaque ones
            // are unusable for replay (their status is 0).
            if (resp && resp.ok) {
              const copy = resp.clone();
              caches.open(CACHE_VERSION).then(c => c.put(req, copy)).catch(() => {});
            }
            return resp;
          }).catch(() => cached); // offline + nothing cached → undefined
        })
      );
      return;
    }
    return; // other cross-origin: passthrough
  }

  // Treat HTML / navigation requests as network-first
  const isHTML =
    req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    event.respondWith(
      fetch(req)
        .then(response => {
          // Update cache copy in background
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Everything else: cache-first, fall back to network
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy)).catch(() => {});
          return response;
        })
        .catch(() => cached);
    })
  );
});
