/* Service Worker for CharmeraTranscoder PWA */

const CACHE_NAME = 'charmera-transcoder-v1';

// Static assets to pre-cache on install
const PRECACHE_ASSETS = [
    './',
    './index.html',
    './app.js',
    './styles.css',
    'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Outfit:wght@300;400;500;600;700;800&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdn.tailwindcss.com',
    'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/umd/ffmpeg.min.js',
    'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
    'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm'
];

// Install Event - Pre-cache critical files
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] Pre-caching application assets...');
                // We map to avoid one failing asset breaking the entire installation cache
                return Promise.all(
                    PRECACHE_ASSETS.map((url) => {
                        return cache.add(new Request(url, { mode: 'cors' }))
                            .catch(err => console.error(`[Service Worker] Failed to cache: ${url}`, err));
                    })
                );
            })
            .then(() => self.skipWaiting())
    );
});

// Activate Event - Clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[Service Worker] Deleting outdated cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch Event - Cache First / Network Fallback with Dynamic Caching
self.addEventListener('fetch', (event) => {
    // Only cache GET requests
    if (event.request.method !== 'GET') return;

    // Skip caching chrome-extension URLs or local dev hot-reloads
    const url = new URL(event.request.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

    event.respondWith(
        caches.match(event.request)
            .then((cachedResponse) => {
                if (cachedResponse) {
                    return cachedResponse;
                }

                // If not cached, fetch from network
                return fetch(event.request)
                    .then((networkResponse) => {
                        // Check if valid response
                        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'error') {
                            return networkResponse;
                        }

                        // Cache the newly fetched file dynamically (e.g., dynamic webfonts, etc.)
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME)
                            .then((cache) => {
                                cache.put(event.request, responseToCache);
                            });

                        return networkResponse;
                    })
                    .catch((err) => {
                        console.error('[Service Worker] Fetch failed:', err);
                        // Optional offline fallback could be returned here if needed
                    });
            })
    );
});
