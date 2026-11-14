// Offline support.
// App files (HTML/JS/CSS/data): network first, so updates show up on the next
// open; the saved copy is used only when offline.
// Big, rarely-changing files (the text reader, map library, icons): cache first.
const CACHE = 'righttime-v6';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './day.js',
  './jobcard.js',
  './jobcard-image.js',
  './manifest.webmanifest',
  './data/stations.json',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  // cache: 'reload' skips the browser's own HTTP cache, so we store the newest files.
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(ASSETS.map(a =>
        fetch(new Request(a, { cache: 'reload' })).then(r => (r.ok ? c.put(a, r) : null)).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const cacheFirst = url => /\/vendor\/|\/icons\//.test(url.pathname);

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  if (cacheFirst(url)) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      }))
    );
    return;
  }

  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html')))
  );
});
