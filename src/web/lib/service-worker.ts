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
        console.error('[WebChuGL] Service worker registration failed:', err);
    });

    if (!navigator.serviceWorker.controller) {
        const key = 'webchugl-sw-reload';
        const count = parseInt(sessionStorage.getItem(key) || '0', 10);
        if (count < 2) {
            sessionStorage.setItem(key, String(count + 1));
            location.reload();
            return true;
        }
        console.warn('[WebChuGL] crossOriginIsolated is still false after ' + count + ' reloads. Giving up.');
        sessionStorage.removeItem(key);
    }

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!window.crossOriginIsolated) location.reload();
    }, { once: true });

    return false;
}
