// MTO Work Report — Service Worker
// Caches the app for offline use

const CACHE = 'mto-report-v1';
const ASSETS = [
  './mto_report.html',
  './manifest.json'
];

// Install — cache core files
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — serve from cache, fall back to network
self.addEventListener('fetch', e => {
  // Don't cache API calls to Anthropic
  if (e.request.url.includes('anthropic.com') ||
      e.request.url.includes('unpkg.com') ||
      e.request.url.includes('maps.gov.bc.ca') ||
      e.request.url.includes('opentopomap.org')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => caches.match('./mto_report.html')))
  );
});
