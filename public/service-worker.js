const CACHE_NAME = 'one-post-v1';
const ASSETS = ['/', '/index.html', '/css/style.css', '/js/app.js'];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))));
});

self.addEventListener('fetch', (event) => {
    if (event.request.url.includes('/api/') || event.request.url.includes('/uploads/')) return;
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});