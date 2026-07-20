// SmartTroli — sw.js
// Bump CACHE_NAME on every deploy that changes cached assets.
const CACHE_NAME = 'smarttroli-cache-v18';
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  // skipWaiting() is intentionally NOT auto-called here.
  // The new worker enters "waiting" state so index.html can detect it
  // and show the "New version available" banner. Activation only happens
  // after the user taps "Update Now", which sends the skipWaiting message below.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Manual update trigger from index.html's "Update Now" button.
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting' || (event.data && event.data.type === 'skipWaiting')) {
    self.skipWaiting();
  }
});

// Stale-while-revalidate: serve from cache instantly (works in low-signal
// supermarket aisles), then refresh the cache in the background from network
// so the next load is up to date.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // API calls (e.g. the Gemini connection health check) must always be live — never served
  // from cache — or a one-time failure/success could get "stuck" on repeat visits.
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cachedResponse) => {
        const networkFetch = fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200 && networkResponse.type !== 'opaque') {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => cachedResponse || caches.match('/index.html'));

        // Return cached copy immediately if we have one; otherwise wait on network.
        return cachedResponse || networkFetch;
      })
    )
  );
});
