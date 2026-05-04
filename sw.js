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

const CACHE_VERSION = 'mto-v3';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(SHELL).catch(() => {}))
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

self.addEventListener('fetch', event => {
  const req = event.request;
  // Only handle same-origin GETs
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

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
