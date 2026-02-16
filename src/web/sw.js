/**
 * WebChuGL Service Worker
 *
 * COOP/COEP headers (required for SharedArrayBuffer / pthreads)
 * Caching for PWA support
 *
 */

var CACHE_NAME = 'webchugl-v5';
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

var coepCredentialless = false;

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

    // If coepCredentialless is enabled and this is a no-cors request,
    // strip credentials so cross-origin resources load without CORS headers
    var request = (coepCredentialless && r.mode === 'no-cors')
        ? new Request(r, { credentials: 'omit' })
        : r;

    event.respondWith(
        caches.match(event.request).then(function(cached) {
            var fetchPromise = fetch(request).then(function(response) {
                // Opaque responses (status 0) can't be modified — pass through
                if (response.status === 0) return response;

                // Cache successful same-origin responses
                if (response.ok && new URL(response.url).origin === self.location.origin) {
                    var clone = response.clone();
                    caches.open(CACHE_NAME).then(function(cache) {
                        cache.put(event.request, clone);
                    });
                }
                return addCoiHeaders(response);
            }).catch(function() {
                // Network failure — return cached version with headers if available
                return cached ? addCoiHeaders(cached) : undefined;
            });

            return cached ? addCoiHeaders(cached) : fetchPromise;
        })
    );
});

// ── Message handler ──────────────────────────────────────────────────
self.addEventListener('message', function(event) {
    if (!event.data) return;

    if (event.data.type === 'deregister') {
        self.registration.unregister().then(function() {
            return self.clients.matchAll();
        }).then(function(clients) {
            clients.forEach(function(client) { client.navigate(client.url); });
        });
    } else if (event.data.type === 'coepCredentialless') {
        coepCredentialless = event.data.value;
    }
});

// ── Helpers ──────────────────────────────────────────────────────────

function addCoiHeaders(response) {
    if (response.type === 'opaqueredirect' || !response.headers) {
        return response;
    }

    var headers = new Headers(response.headers);
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy',
        coepCredentialless ? 'credentialless' : 'require-corp');

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: headers
    });
}
