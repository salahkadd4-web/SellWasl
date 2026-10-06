/* Service worker de SellWasl (phase 22).
 * Cache des fichiers statiques seulement ; jamais les données de l'API, qui restent toujours
 * celles du serveur. Pages : réseau d'abord, page « hors ligne » si le réseau manque. */

const VERSION = 'sellwasl-v1';
const PRECACHE = ['/offline.html', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

// Nouvelle version : les anciens caches sont supprimés, pas de mélange de fichiers
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Fichiers statiques versionnés par Next.js, polices et icônes : cache d'abord. */
function isStatic(url) {
  return (
    url.pathname.startsWith('/_next/static/') || /\.(?:png|svg|ico|woff2?|ttf)$/.test(url.pathname)
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Seules les requêtes GET de ce site ; jamais l'API
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
    return;
  }
  if (isStatic(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
