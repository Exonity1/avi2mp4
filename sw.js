/* Service Worker for CharmeraTranscoder PWA */

const CACHE_NAME = 'charmera-transcoder-v8';

// Static assets to pre-cache on install
const PRECACHE_ASSETS = [
    './',
    './index.html',
    './app.js',
    './worker.js',
    './styles-compiled.css',
    'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Outfit:wght@300;400;500;600;700;800&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    './ffmpeg/ffmpeg.min.js',
    './ffmpeg/ffmpeg-core.js',
    './ffmpeg/ffmpeg-core.wasm',
    './ffmpeg/ffmpeg-core.worker.js'
];

// Helper to check and override MIME types to resolve Windows Registry / Python server bugs
async function getOverriddenResponse(url, response) {
    if (!response || response.type === 'opaque' || response.status !== 200) {
        return response;
    }

    const cleanUrl = url.split('?')[0].split('#')[0];
    let contentType = null;

    if (cleanUrl.endsWith('.js')) {
        contentType = 'text/javascript';
    } else if (cleanUrl.endsWith('.wasm')) {
        contentType = 'application/wasm';
    } else if (cleanUrl.endsWith('.css')) {
        contentType = 'text/css';
    }

    if (contentType) {
        const newHeaders = new Headers(response.headers);
        newHeaders.set('Content-Type', contentType);
        const blob = await response.blob();
        return new Response(blob, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders
        });
    }
    return response;
}

// Install Event - Pre-cache critical files with MIME type correction
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] Pre-caching application assets...');
                return Promise.all(
                    PRECACHE_ASSETS.map((url) => {
                        const fetchOptions = url.includes('http') ? { mode: 'cors' } : undefined;
                        return fetch(url, fetchOptions)
                            .then(async (response) => {
                                const cleanResponse = await getOverriddenResponse(url, response);
                                return cache.put(url, cleanResponse);
                            })
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
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

    event.respondWith(
        caches.match(event.request)
            .then((cachedResponse) => {
                if (cachedResponse) {
                    return cachedResponse;
                }

                return fetch(event.request)
                    .then(async (networkResponse) => {
                        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'error') {
                            return networkResponse;
                        }

                        const cleanResponse = await getOverriddenResponse(event.request.url, networkResponse);
                        const responseToCache = cleanResponse.clone();
                        
                        caches.open(CACHE_NAME)
                            .then((cache) => {
                                cache.put(event.request, responseToCache);
                            });

                        return cleanResponse;
                    })
                    .catch((err) => {
                        console.error('[Service Worker] Fetch failed:', err);
                    });
            })
    );
});
