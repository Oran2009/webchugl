/**
 * Register a service worker for COOP/COEP headers + offline caching.
 * Returns `true` if a page reload was triggered (caller should abort init).
 */
export function registerServiceWorker(swUrl: string): boolean {
    if (!('serviceWorker' in navigator)) return false;

    if (window.crossOriginIsolated) {
        sessionStorage.removeItem('webchugl-sw-reload');
        return false;
    }

    if (!window.isSecureContext) {
        console.log('[WebChuGL] Service worker requires a secure context (HTTPS or localhost).');
        return false;
    }

    navigator.serviceWorker.register(swUrl).catch((err: Error) => {
        // Missing/unreachable sw.js: stop the reload loop and say exactly how to fix it.
        sessionStorage.setItem('webchugl-sw-reload', '99');
        console.error(
            '[WebChuGL] Could not register ' + swUrl + ': ' + err.message + '\n' +
            'Audio needs cross-origin isolation. Create a file named sw.js next to your\n' +
            'index.html containing this one line:\n\n' +
            "    importScripts('https://cdn.jsdelivr.net/npm/webchugl/dist/sw.js');\n\n" +
            'Or send COOP/COEP headers from your server and pass serviceWorker: false.'
        );
    });

    if (!navigator.serviceWorker.controller) {
        const key = 'webchugl-sw-reload';
        const count = parseInt(sessionStorage.getItem(key) || '0', 10);
        if (count < 2) {
            sessionStorage.setItem(key, String(count + 1));
            location.reload();
            return true;
        }
        console.warn(
            '[WebChuGL] crossOriginIsolated is still false after ' + count + ' reloads. Giving up.' +
            '\nsw.js must sit at the site root, next to index.html -- a service worker only' +
            '\ncontrols pages at or below its own directory.'
        );
        sessionStorage.removeItem(key);
    }

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!window.crossOriginIsolated) location.reload();
    }, { once: true });

    return false;
}
