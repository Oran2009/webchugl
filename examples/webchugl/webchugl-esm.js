/**
 * WebChuGL ESM Entry Point
 *
 * Usage:
 *   import ChuGL from 'webchugl';
 *   // or: import ChuGL from 'https://cdn.jsdelivr.net/npm/webchugl/+esm';
 *
 *   const ck = await ChuGL.init({
 *       canvas: document.getElementById('my-canvas'),
 *       whereIsChuGL: 'https://my-server.com/webchugl/',
 *   });
 *
 *   ck.runCode('SinOsc s => dac; while(true) 100::ms => now;');
 *   // or: await ck.runZip('./bundle.zip');
 *
 * IMPORTANT: WebChuGL requires Cross-Origin Isolation (SharedArrayBuffer).
 * Your server must send these headers:
 *   Cross-Origin-Opener-Policy: same-origin
 *   Cross-Origin-Embedder-Policy: credentialless
 */

/**
 * @typedef {Object} ChucK
 * @property {function(string): Promise<number>} runCode - Compile and run ChucK code.
 * @property {function(string): Promise<number>} runFile - Run a ChucK file. Accepts a VFS path (/code/main.ck), a filename already loaded into VFS (main.ck), or a URL (./main.ck) which is fetched first.
 * @property {function(string, (string|ArrayBuffer)): void} createFile - Write a file to the virtual filesystem.
 * @property {function(string, string=): Promise<string>} loadFile - Fetch a URL and write it to the virtual filesystem.
 * @property {function(string, string[]): Promise<string[]>} loadFiles - Fetch multiple files from a base path into /code/.
 * @property {function(string): Promise<void>} loadZip - Fetch a zip and extract all files to the virtual filesystem.
 * @property {function(string, string=): Promise<number>} runZip - Fetch a zip, extract to VFS, and run the main file.
 * @property {function(string, number): void} setInt - Set a global int variable.
 * @property {function(string, number): void} setFloat - Set a global float variable.
 * @property {function(string, string): void} setString - Set a global string variable.
 * @property {function(string): Promise<number>} getInt - Get a global int variable.
 * @property {function(string): Promise<number>} getFloat - Get a global float variable.
 * @property {function(string): Promise<string>} getString - Get a global string variable.
 * @property {function(string): void} signalEvent - Signal a global event.
 * @property {function(string): void} broadcastEvent - Broadcast a global event.
 * @property {function(string, Function): number} listenForEvent - Listen for a global event (repeating).
 * @property {function(string, Function): number} listenForEventOnce - Listen for a global event (once).
 * @property {function(string, number): void} stopListeningForEvent - Stop listening for a global event.
 * @property {function(string, number[]): void} setIntArray - Set a global int array.
 * @property {function(string, number[]): void} setFloatArray - Set a global float array.
 * @property {function(string): Promise<number[]>} getIntArray - Get a global int array.
 * @property {function(string): Promise<number[]>} getFloatArray - Get a global float array.
 * @property {function(string, *): Promise<void>} save - Save a value to IndexedDB.
 * @property {function(string): Promise<*>} load - Load a value from IndexedDB.
 * @property {function(string): Promise<void>} delete - Delete a value from IndexedDB.
 * @property {function(): Promise<string[]>} listKeys - List all IndexedDB keys.
 * @property {function(string, string): Promise<string>} loadAudio - Fetch audio, decode to WAV, and write to VFS.
 * @property {function(MIDIAccess): void} initMidi - Initialize MIDI with a Web MIDI API MIDIAccess object.
 * @property {function(string): Promise<string>} loadChugin - Fetch and load a .chug.wasm chugin. Returns the chugin name.
 * @property {function(string, string=, string=): Promise<string>} loadPackage - Load a ChuMP package by name. Args: name, version?, url?.
 * @property {AudioContext} audioContext - The AudioContext (null until audio initializes).
 * @property {AudioWorkletNode} audioNode - The AudioWorkletNode (null until audio initializes).
 */

var _initialized = false;

function _loadScript(url) {
    return new Promise(function(resolve, reject) {
        var s = document.createElement('script');
        s.src = url;
        s.onload = resolve;
        s.onerror = function() { reject(new Error('Failed to load: ' + url)); };
        document.head.appendChild(s);
    });
}

var ChuGL = {
    /**
     * Initialize ChuGL.
     *
     * @param {Object} config
     * @param {HTMLCanvasElement} config.canvas - Canvas element for WebGPU rendering.
     * @param {string} config.whereIsChuGL - Base URL where WebChuGL assets are
     *   hosted (index.js, index.wasm, audio-worklet-processor.js, jszip.min.js).
     *   Must end with '/'. Required.
     * @param {string[]} [config.chugins] - Array of URLs to .chug.wasm files
     *   to load before the VM starts. These are fetched in parallel with
     *   WebGPU initialization.
     * @param {boolean} [config.serviceWorker=true] - Register a service worker
     *   that injects COOP/COEP headers for cross-origin isolation. Set to false
     *   if your server already sends these headers.
     * @param {Object} [config.audioConfig] - Audio configuration.
     * @param {number} [config.audioConfig.sampleRate=48000]
     * @param {number} [config.audioConfig.outputChannels=2]
     * @param {number} [config.audioConfig.inputChannels=2]
     * @param {Function} [config.onProgress] - Progress callback, receives 0-100.
     * @param {Function} [config.onError] - Error callback, receives message string.
     * @param {Function} [config.onReady] - Called when WebGPU init completes and
     *   the canvas is ready for rendering.
     * @returns {Promise<ChucK>} Resolves to a ChucK instance.
     */
    init: function(config) {
        if (_initialized) {
            return Promise.reject(new Error('ChuGL.init() has already been called. Only one instance is supported.'));
        }
        if (!config || !config.canvas) {
            return Promise.reject(new Error('ChuGL.init() requires config.canvas'));
        }
        if (!config.whereIsChuGL) {
            return Promise.reject(new Error('ChuGL.init() requires config.whereIsChuGL'));
        }

        _initialized = true;

        var baseUrl = config.whereIsChuGL;
        if (baseUrl[baseUrl.length - 1] !== '/') baseUrl += '/';

        // Warn if cross-origin isolation is missing
        if (!window.crossOriginIsolated) {
            console.warn(
                '[WebChuGL] window.crossOriginIsolated is false. ' +
                'SharedArrayBuffer (required for audio) may not be available. ' +
                'Ensure your server sends COOP/COEP headers.'
            );
        }

        return _loadScript(baseUrl + 'index.js')
            .then(function() {
                return _loadScript(baseUrl + 'webchugl.js');
            })
            .then(function() {
                if (typeof _initWebChuGL !== 'function') {
                    throw new Error('webchugl.js did not define _initWebChuGL');
                }
                return _initWebChuGL({
                    canvas: config.canvas,
                    baseUrl: baseUrl,
                    chugins: config.chugins || [],
                    serviceWorker: config.serviceWorker !== false,
                    audioConfig: config.audioConfig,
                    onProgress: config.onProgress,
                    onError: config.onError,
                    onReady: config.onReady
                });
            });
    }
};

export default ChuGL;
export { ChuGL };
