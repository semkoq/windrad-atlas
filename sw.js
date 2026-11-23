/* Service Worker: macht den Windrad-Atlas installierbar und offline nutzbar.
   - App-Dateien und Anlagendaten: aus dem Speicher, im Hintergrund aktualisiert
   - Kartenkacheln: aus dem Netz, zuletzt gesehene werden für offline zwischengespeichert */
const VERSION = 'v6';
const APP_CACHE = 'atlas-app-' + VERSION;
const TILE_CACHE = 'atlas-tiles-' + VERSION;
const MAX_TILES = 1500;

const APP_FILES = [
  './', 'index.html', 'style.css', 'app.js', 'config.js', 'data/vestas-de.json', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.min.js',
];

const TILE_HOSTS = ['server.arcgisonline.com', 'tile.openstreetmap.de', 'basemaps.cartocdn.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== APP_CACHE && k !== TILE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trimTiles() {
  const c = await caches.open(TILE_CACHE);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Kartenkacheln: Netz zuerst, bei Funkloch aus dem Speicher
  if (TILE_HOSTS.some((h) => url.hostname.endsWith(h))) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(TILE_CACHE).then((c) => c.put(req, copy)).then(trimTiles);
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // App-Dateien und Daten: sofort aus dem Speicher, im Hintergrund aktualisieren
  if (url.origin === location.origin || url.hostname === 'cdnjs.cloudflare.com') {
    e.respondWith(
      caches.open(APP_CACHE).then(async (c) => {
        const cached = await c.match(req, { ignoreSearch: true });
        const network = fetch(req).then((res) => {
          if (res.ok) c.put(req, res.clone());
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
  }
});
