// ============================================================================
// WebChuGL ESM Entry Point
// ============================================================================

import type {
    ChucK,
    RunResult,
    ChuGLConfig,
    ChuginEntry,
    AudioConfig,
    ShredInfo,
    ReplaceResult,
    GlobalVariableInfo,
    WebChuGLInternalConfig,
} from './types/chuck.js';

type RuntimeModule = {
    initWebChuGL: (config: WebChuGLInternalConfig) => Promise<ChucK>;
};

let _runtime: Promise<RuntimeModule> | null = null;

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
     * Multiple instances are supported — each call creates an independent
     * ChucK VM with its own canvas, audio, and graphics state.
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

        // Loaded once and shared across instances.
        if (!_runtime) {
            _runtime = import(/* @vite-ignore */ baseUrl + 'webchugl.js')
                .catch(function (e: Error) {
                    _runtime = null;
                    throw e;
                }) as Promise<RuntimeModule>;
        }

        return _runtime.then(function (runtime) {
            return runtime.initWebChuGL({
                ...config,
                baseUrl,
                chugins: config.chugins || [],
                serviceWorker: config.serviceWorker !== false,
            });
        });
    },
};

export default ChuGL;
export { ChuGL };

export type {
    ChucK,
    RunResult,
    ChuGLConfig,
    ChuginEntry,
    AudioConfig,
    ShredInfo,
    ReplaceResult,
    GlobalVariableInfo,
};
