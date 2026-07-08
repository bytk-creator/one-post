const CACHE_NAME = 'one-post-v2';

self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE_NAME).then((c) => c.addAll(['/', '/css/style.css', '/js/app.js']))
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE_NAME).map((x) => caches.delete(x))))
    );
    return self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    if (e.request.url.includes('/api/') || e.request.url.includes('/uploads/')) return;
    e.respondWith(
        fetch(e.request)
            .then((response) => {
                const clone = response.clone();
                caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
                return response;
            })
            .catch(() => caches.match(e.request))
    );
});
