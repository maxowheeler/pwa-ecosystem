// office-sw.js — Service worker for the Office Status PWA
// Stale-while-revalidate for all assets.
// Deploy to: /home/shyguy/apps/office/sw.js

const CACHE_NAME = 'office-v2';

const PRECACHE = [
  '/office/index.html',
  '/office/office.js',
  '/office/office.css',
  '/shared/theme.css',
  '/shared/config.js',
  '/shared/storage.js',
  '/shared/sync.js',
  '/shared/ui.js',
  '/shared/versions.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never intercept the TRMNL webhook, Pi sync, or font requests
  if (url.hostname.includes('trmnl.com')) return;
  if (url.pathname.includes('sync.php')) return;
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) return;

  // Never intercept the image picker's file list or the images themselves —
  // these must always reflect what's actually on the Pi right now. Caching
  // them here would let deleted/renamed files keep showing up in the picker
  // indefinitely, since a cached response wins over fetch()'s cache:'no-store'
  // option (that option only affects normal HTTP caching, not a service
  // worker sitting in front of it).
  if (url.pathname.includes('list-pics.php')) return;
  if (url.pathname.includes('/office/pics/')) return;

  // Stale-while-revalidate for everything else (including HTML)
  // Serves from cache immediately, updates cache in background
  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(event.request).then(cached => {
        const fetchPromise = fetch(event.request).then(response => {
          if (response && response.status === 200 && response.type === 'basic') {
            cache.put(event.request, response.clone());
          }
          return response;
        }).catch(() => cached); // network failed — cached already returned

        return cached || fetchPromise; // serve cache instantly if available
      })
    )
  );
});
