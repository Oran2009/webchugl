// ============================================================================
// WebChuGL ESM Entry Point
// ============================================================================

import type {
    ChucK,
    AudioConfig,
    ShredInfo,
    ReplaceResult,
    GlobalVariableInfo,
    WebChuGLInternalConfig,
} from './types/chuck.js';

// -- Ambient declaration for _initWebChuGL (defined in webchugl.ts, loaded
//    via <script> before this module's init() runs) -------------------------

declare function _initWebChuGL(config: WebChuGLInternalConfig): Promise<ChucK>;

// ============================================================================
// Public Interfaces
// ============================================================================

/**
 * Configuration object passed to {@link ChuGL.init}.
 */
interface ChuGLConfig {
    /** **Required.** Canvas element for WebGPU rendering. */
    canvas: HTMLCanvasElement;
    /**
     * Base URL where WebChuGL runtime assets are hosted (`index.js`,
     * `webchugl.wasm`, `audio-worklet-processor.js`, `jszip.min.js`).
     * Must end with `/`. Defaults to the jsdelivr CDN.
     */
    whereIsChuGL?: string;
    /**
     * Array of URLs to `.chug.wasm` files to load before the VM starts.
     * Fetched in parallel with WebGPU init.
     */
    chugins?: string[];
    /**
     * Register a service worker that injects COOP/COEP headers for
     * cross-origin isolation. Set to `false` if your server already
     * sends these headers. Defaults to `true`.
     */
    serviceWorker?: boolean;
    /** Audio configuration. */
    audioConfig?: AudioConfig;
    /** Progress callback, receives 0-100. */
    onProgress?: (pct: number) => void;
    /** Error callback, receives a message string. */
    onError?: (msg: string) => void;
    /** Called when WebGPU init completes and the canvas is ready for rendering. */
    onReady?: () => void;
}

// ============================================================================
// ChuGL -- initialization
// ============================================================================

let _initPromise: Promise<ChucK> | null = null;

function _loadScript(url: string): Promise<void> {
    return new Promise(function (resolve, reject) {
        const s = document.createElement('script');
        s.src = url;
        s.onload = () => resolve();
        s.onerror = function () {
            reject(new Error('Failed to load: ' + url));
        };
        document.head.appendChild(s);
    });
}

/**
 * The ChuGL entry point. Call {@link ChuGL.init} to create a
 * {@link ChucK} instance.
 *
 * @example
 * import ChuGL from 'https://cdn.jsdelivr.net/npm/webchugl/+esm';
 *
 * var ck = await ChuGL.init({
 *     canvas: document.getElementById('canvas'),
 * });
 */
const ChuGL = {
    /**
     * Initialize WebChuGL and return a {@link ChucK} instance.
     * Only one instance is supported -- calling `init()` a second time
     * returns a rejected promise.
     *
     * @param config - Configuration options.
     * @returns Resolves to a {@link ChucK} instance.
     *
     * @example
     * var ck = await ChuGL.init({
     *     canvas: document.getElementById('canvas'),
     *     chugins: ['./chugins/Bitcrusher.chug.wasm'],
     *     audioConfig: { sampleRate: 44100 },
     * });
     */
    init: function (config: ChuGLConfig): Promise<ChucK> {
        if (_initPromise) {
            return Promise.reject(
                new Error(
                    'ChuGL.init() has already been called. Only one instance is supported.',
                ),
            );
        }
        if (!config || !config.canvas) {
            return Promise.reject(
                new Error('ChuGL.init() requires config.canvas'),
            );
        }

        let baseUrl =
            config.whereIsChuGL ||
            'https://cdn.jsdelivr.net/npm/webchugl@__WEBCHUGL_VERSION__/dist/';
        if (baseUrl[baseUrl.length - 1] !== '/') baseUrl += '/';

        // Validate baseUrl scheme to prevent loading scripts from untrusted origins
        if (
            baseUrl.indexOf('://') !== -1 &&
            baseUrl.indexOf('https://') !== 0 &&
            baseUrl.indexOf('http://localhost') !== 0 &&
            baseUrl.indexOf('http://127.0.0.1') !== 0
        ) {
            return Promise.reject(
                new Error(
                    'ChuGL.init(): whereIsChuGL must use https:// (or http://localhost for development)',
                ),
            );
        }

        // Warn if cross-origin isolation is missing
        if (!window.crossOriginIsolated) {
            console.warn(
                '[WebChuGL] window.crossOriginIsolated is false. ' +
                    'SharedArrayBuffer (required for audio) may not be available. ' +
                    'Ensure your server sends COOP/COEP headers.',
            );
        }

        _initPromise = _loadScript(baseUrl + 'index.js')
            .then(function () {
                return _loadScript(baseUrl + 'webchugl.js');
            })
            .then(function () {
                if (typeof _initWebChuGL !== 'function') {
                    throw new Error(
                        'webchugl.js did not define _initWebChuGL',
                    );
                }
                return _initWebChuGL({
                    canvas: config.canvas,
                    baseUrl: baseUrl,
                    chugins: config.chugins || [],
                    serviceWorker: config.serviceWorker !== false,
                    audioConfig: config.audioConfig,
                    onProgress: config.onProgress,
                    onError: config.onError,
                    onReady: config.onReady,
                });
            })
            .catch(function (e: Error) {
                _initPromise = null;
                throw e;
            });

        return _initPromise;
    },
};

export default ChuGL;
export { ChuGL };

export type {
    ChucK,
    ChuGLConfig,
    AudioConfig,
    ShredInfo,
    ReplaceResult,
    GlobalVariableInfo,
};
