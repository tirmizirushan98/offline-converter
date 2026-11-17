// Offline cache: the app keeps working with no connection once it has been opened.
const CACHE = 'offline-converter-v5';
const ASSETS = [
  './', 'index.html', 'style.css', 'app.js', 'tools.js', 'browser-engine.js', 'photo-tool.js', 'manifest.webmanifest',
  'icon.svg', 'icon-192.png', 'icon-512.png',
  'vendor/pdf-lib.min.js', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'vendor/xlsx.full.min.js',
  'vendor/mammoth.browser.min.js', 'vendor/jszip.min.js', 'vendor/html2pdf.bundle.min.js',
];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.includes('/api/')) return; // never cache conversions
  // network first (picks up updates), cache as fallback (offline)
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
