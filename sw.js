const CACHE_NAME = 'automation-manager-v2';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/db/database.js',
  './js/utils/helpers.js',
  './js/utils/migration.js',
  './js/ui/navigation.js',
  './js/views/dashboard.js',
  './js/views/clients.js',
  './js/views/services.js',
  './js/views/quotes.js',
  './js/views/projects.js',
  './js/views/billing.js',
  './js/views/team_notes.js',
  './js/views/reports_settings.js',
  './manifest.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
  'https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) return response;
        return fetch(event.request).then(fetchResponse => {
          // Allow opaque responses (type === 'opaque') for cross-origin resources like CDNs
          if(!fetchResponse || fetchResponse.status !== 200 && fetchResponse.type !== 'opaque') {
            return fetchResponse;
          }
          let responseToCache = fetchResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
          return fetchResponse;
        });
      })
  );
});
