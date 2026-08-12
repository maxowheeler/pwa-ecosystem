// bike-sw.js — Service worker for the CommuteLog PWA
// Network-first for HTML (always fresh), cache-first for JS/CSS assets.
// Deploy to: /home/shyguy/apps/bike/sw.js

const CACHE_NAME = 'bike-v3';

const PRECACHE = [
  '/bike/index.html',
  '/bike/bike.js',
  '/bike/bike.css',
  '/shared/theme.css',
  '/shared/config.js',
  '/shared/storage.js',
  '/shared/sync.js',
  '/shared/ui.js',
  '/shared/versions.js',
];

// HTML files — always revalidate to prevent stale back-navigation
const HTML_FILES = ['/bike/index.html'];

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

  // Never intercept sync or font requests
  if (url.pathname.includes('sync.php')) return;
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) return;

  // Stale-while-revalidate for ALL assets (including HTML)
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
