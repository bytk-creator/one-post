const CACHE_NAME = 'one-post-v22';

// Кэшируем только статику, НЕ главную страницу
const ASSETS = ['/css/style.css', '/js/app.js'];

self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE_NAME).map((x) => caches.delete(x)))));
    return self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    // Пропускаем API, uploads и главную страницу
    if (e.request.url.includes('/api/') || e.request.url.includes('/uploads/')) return;
    if (e.request.url === self.location.origin + '/' || e.request.url.endsWith('/index.html')) return;
    
    e.respondWith(
        caches.match(e.request).then((cached) => cached || fetch(e.request).then((response) => {
            if (response.ok) {
                const clone = response.clone();
                caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
            }
            return response;
        }))
    );
});
