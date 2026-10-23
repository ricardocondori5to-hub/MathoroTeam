const CACHE_NAME = 'mathoro-pwa-v9';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './pwa-responsive.css',
  './pwa-runtime.js',
  './transiciones.css',
  './transiciones.js',
  './sonidos-ui.js',
  './imagenes/app-icons/icon-192.png',
  './imagenes/app-icons/icon-512.png',
  './imagenes/app-icons/icon-512-maskable.png',
  './imagenes/app-icons/apple-touch-icon.png',
  './imagenes/menumath.png',
  './imagenes/logomath.png',
  './imagenes/barritamath.png',
  './imagenes/iniciomath.png',
  './imagenes/recomp-volver.png'
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
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('mathoro-pwa-') && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/') || url.pathname.includes('/data/') || url.pathname.endsWith('/server.py')) return;
  if (request.destination === 'video' || request.destination === 'audio') return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        const cachedPage = await caches.match(request);
        return cachedPage || caches.match(new URL('./index.html', self.registration.scope));
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
      }
      return response;
    } catch {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
