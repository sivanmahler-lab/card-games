// Minimal service worker: caches the app shell (the three game pages + icons) so the
// lobby and both games' vs-computer/local modes still open after the first visit, even
// with no connection. Online multiplayer still needs a live network for Firebase either
// way, so this deliberately does NOT try to cache or intercept anything Firebase-related.
const CACHE_NAME = 'card-games-v1';
const APP_SHELL = [
  './index.html',
  './whist.html',
  './sheshiyot.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Only handle same-origin requests for our own files — everything else (Firebase's
  // SDK scripts, the realtime database connection, Google Fonts, etc.) goes straight to
  // the network untouched.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      // Cache-first for instant loads / offline support, but still refresh the cache
      // in the background so updates aren't stuck forever behind the service worker.
      return cached || network;
    })
  );
});
