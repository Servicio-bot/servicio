/* Guarda la app en el teléfono para que abra sin señal */
const CACHE = 'eco-servicio-v2';
const FILES = ['./', './index.html', './app.js', './pdf.js', './logo.js', './config.js', './vendor/pdf-lib.min.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Intenta la red para recibir actualizaciones; si demora o no hay señal, usa la copia guardada
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(e.request, {ignoreSearch: true});
    const net = fetch(e.request).then(r => { if (r.ok) cache.put(e.request, r.clone()); return r; }).catch(() => null);
    if (cached) return (await Promise.race([net, new Promise(res => setTimeout(() => res(null), 2500))])) || cached;
    return (await net) || (await cache.match('./index.html')) || Response.error();
  })());
});
