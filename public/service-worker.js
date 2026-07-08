const CACHE_NAME = 'one-post-v1';
const ASSETS = ['/', '/index.html', '/css/style.css', '/js/app.js'];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE_NAME).map((x) => caches.delete(x)))));
});

self.addEventListener('fetch', (e) => {
    if (e.request.url.includes('/api/') || e.request.url.includes('/uploads/')) return;
    e.respondWith(caches.match(e.request).then((c) => c || fetch(e.request)));
});