/**
 * WebChuGL Service Worker
 *
 * COOP/COEP headers (required for SharedArrayBuffer / pthreads)
 * Caching for PWA support
 *
 */

var CACHE_NAME = 'webchugl-v6';
var ASSETS_TO_CACHE = [
    './',
    'index.html',
    'manifest.json',
    'bundle.zip',
    'webchugl/index.js',
    'webchugl/index.wasm',
    'webchugl/webchugl.js',
    'webchugl/audio-worklet-processor.js',
    'webchugl/jszip.min.js',
    'webchugl/chugl_logo_light.png',
    'webchugl/chugl_logo_dark.png'
];

// ── Install: pre-cache app assets ────────────────────────────────────
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            // Cache failure is non-fatal (assets may not all be available during dev)
            return cache.addAll(ASSETS_TO_CACHE).catch(function() {});
        }).then(function() {
            return self.skipWaiting();
        })
    );
});

// ── Activate: clean old caches, claim clients ────────────────────────
self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(
                keys.filter(function(k) { return k !== CACHE_NAME; })
                    .map(function(k) { return caches.delete(k); })
            );
        }).then(function() {
            return self.clients.claim();
        })
    );
});

// ── Fetch: cache-first + add COOP/COEP headers ──────────────────────
self.addEventListener('fetch', function(event) {
    var r = event.request;

    // Only handle GET requests
    if (r.method !== 'GET') return;

    // Chrome bug: only-if-cached with mode !== same-origin causes fetch to fail
    if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;

    // Don't intercept cross-origin requests (avoids CORS issues with
    // external APIs like EventSource, CDN resources, etc.)
    if (new URL(r.url).origin !== self.location.origin) return;

    // Strip credentials on no-cors requests so cross-origin resources
    // load without CORS headers under credentialless COEP
    var request = (r.mode === 'no-cors')
        ? new Request(r, { credentials: 'omit' })
        : r;

    event.respondWith(
        caches.match(event.request).then(function(cached) {
            if (cached) {
                // Serve from cache immediately (with COI headers).
                // Also update the cache in the background (stale-while-revalidate).
                fetch(request).then(function(response) {
                    if (response.ok && new URL(response.url).origin === self.location.origin) {
                        caches.open(CACHE_NAME).then(function(cache) {
                            cache.put(event.request, response);
                        });
                    }
                }).catch(function() {});
                return addCoiHeaders(cached);
            }

            // No cache — go to network
            return fetch(request).then(function(response) {
                if (response.status === 0) return response;

                if (response.ok && new URL(response.url).origin === self.location.origin) {
                    var clone = response.clone();
                    caches.open(CACHE_NAME).then(function(cache) {
                        cache.put(event.request, clone);
                    });
                }
                return addCoiHeaders(response);
            });
        })
    );
});

// ── Helpers ──────────────────────────────────────────────────────────

function addCoiHeaders(response) {
    if (response.type === 'opaqueredirect' || !response.headers) {
        return response;
    }

    var headers = new Headers(response.headers);
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'credentialless');

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: headers
    });
}
