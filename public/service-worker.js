const CACHE_NAME = 'one-post-v31';

const ASSETS = [
    '/css/style.css', 
    '/js/app.js',
    '/icon-192.svg',
    '/icon-512.svg',
    '/manifest.json'
];

self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('🟢 Кэшируем ресурсы...');
            return cache.addAll(ASSETS).catch(err => {
                console.error('❌ Ошибка кэширования:', err);
            });
        })
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => {
                    console.log('🗑 Удаляем старый кэш:', key);
                    return caches.delete(key);
                })
            );
        })
    );
    return self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    
    // Пропускаем API-запросы
    if (url.pathname.startsWith('/api/')) return;
    
    // Пропускаем загруженные файлы
    if (url.pathname.startsWith('/uploads/')) return;
    
    // WebSocket
    if (url.pathname === '/ws') return;
    
    // Главная страница — всегда сеть
    if (url.pathname === '/' || url.pathname === '/index.html') return;
    
    e.respondWith(
        caches.match(e.request).then((cached) => {
            if (cached) {
                // Обновляем кэш в фоне
                fetch(e.request).then((response) => {
                    if (response.ok) {
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(e.request, response);
                        });
                    }
                }).catch(() => {});
                
                return cached;
            }
            
            // Если нет в кэше — идём в сеть
            return fetch(e.request).then((response) => {
                if (response.ok && response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(e.request, clone);
                    });
                }
                return response;
            }).catch(() => {
                // Оффлайн-fallback
                if (e.request.mode === 'navigate') {
                    return new Response(
                        `<!DOCTYPE html>
                        <html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
                        <title>Оффлайн — Один Пост</title>
                        <style>
                            body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #F0F2F5; color: #1A1D26; text-align: center; margin: 0; }
                            .card { background: white; padding: 40px; border-radius: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); margin: 20px; }
                            h1 { font-size: 48px; margin-bottom: 10px; }
                            p { color: #6B7280; line-height: 1.5; }
                        </style></head>
                        <body>
                            <div class="card">
                                <h1>📡</h1>
                                <h2>Нет подключения</h2>
                                <p>Проверьте интернет и попробуйте снова</p>
                            </div>
                        </body></html>`,
                        { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
                    );
                }
                
                // Для изображений — SVG-заглушка
                if (e.request.destination === 'image') {
                    return new Response(
                        `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
                            <rect fill="#E5E7EB" width="200" height="200"/>
                            <text x="100" y="100" text-anchor="middle" dominant-baseline="middle" font-size="40">🖼</text>
                        </svg>`,
                        { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' } }
                    );
                }
                
                return new Response('Offline', { status: 408 });
            });
        })
    );
});

// Уведомление о новой версии
self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
});
