// ============================================================================
// ChucK Instance — returned by ChuGL.init()
// ============================================================================

/**
 * The ChucK instance returned by {@link ChuGL.init}. Provides the full
 * JavaScript &harr; ChucK bridge: run code, get/set global variables, listen
 * for events, load files and audio, and more.
 *
 * All methods auto-queue until the ChucK VM is ready, so you can call them
 * immediately after `ChuGL.init()` resolves.
 *
 * @class ChucK
 * @hideconstructor
 */

// ── Code Execution ──────────────────────────────────────────────────────

/**
 * Compile and run ChucK code.
 *
 * @function runCode
 * @memberof ChucK
 * @instance
 * @param {string} code - ChucK source code to compile and run.
 * @returns {Promise<number>} 1 on success, 0 on failure.
 * @example
 * ck.runCode('SinOsc s => dac; while(true) GG.nextFrame() => now;');
 */

/**
 * Run a ChucK file. Accepts three kinds of input:
 * - **VFS path** (`/code/main.ck`) — run directly from the virtual filesystem.
 * - **Filename** (`main.ck`) — looks up `/code/main.ck` in the VFS.
 * - **URL** (`./main.ck`) — fetches the file, writes it to the VFS, then runs it.
 *
 * @function runFile
 * @memberof ChucK
 * @instance
 * @param {string} pathOrUrl - A VFS path, filename, or URL.
 * @returns {Promise<number>} 1 on success, 0 on failure.
 * @example
 * await ck.runFile('./main.ck');
 */

/**
 * Fetch a zip archive, extract to VFS, and run the main ChucK file.
 * If `mainFile` is omitted, auto-detects `main.ck` at the zip root,
 * or falls back to the first `.ck` file found.
 *
 * @function runZip
 * @memberof ChucK
 * @instance
 * @param {string} url - URL of the zip file.
 * @param {string} [mainFile] - Entry point file path (e.g. `game.ck`).
 * @returns {Promise<number>} 1 on success, 0 on failure.
 * @example
 * await ck.runZip('./bundle.zip');
 * // or with an explicit entry point:
 * await ck.runZip('./bundle.zip', 'game.ck');
 */

// ── Virtual Filesystem ──────────────────────────────────────────────────

/**
 * Write a file to the virtual filesystem.
 *
 * Unlike the `load*` functions, this requires a full VFS path — no
 * automatic `/code/` prefix is added.
 *
 * @function createFile
 * @memberof ChucK
 * @instance
 * @param {string} path - Destination path in the VFS (e.g. `/code/data.txt`).
 * @param {string|ArrayBuffer} data - File contents (string for text, ArrayBuffer for binary).
 */

/**
 * Remove a file or directory from the virtual filesystem. Directories
 * are removed recursively. Returns `true` if the path was removed,
 * `false` if it didn't exist.
 *
 * @function removeFile
 * @memberof ChucK
 * @instance
 * @param {string} path - Absolute VFS path to remove.
 * @returns {boolean} `true` if removed, `false` if path didn't exist.
 * @example
 * ck.removeFile('/code/temp.wav');
 * ck.removeFile('/code/old-assets'); // removes directory recursively
 */

/**
 * Check whether a file or directory exists in the virtual filesystem.
 *
 * @function fileExists
 * @memberof ChucK
 * @instance
 * @param {string} path - Absolute VFS path to check.
 * @returns {boolean} `true` if the path exists.
 * @example
 * if (ck.fileExists('/code/config.ck')) {
 *     await ck.runFile('/code/config.ck');
 * }
 */

/**
 * List all files in a VFS directory (recursively). Useful for debugging
 * "file not found" errors or inspecting what `loadZip` extracted.
 *
 * @function listFiles
 * @memberof ChucK
 * @instance
 * @param {string} [dir='/code'] - Directory to list. Defaults to `/code`.
 * @returns {string[]} Array of absolute VFS paths.
 * @example
 * await ck.loadZip('./bundle.zip');
 * console.log(ck.listFiles());
 * // ['/code/main.ck', '/code/lib/utils.ck', '/code/assets/click.wav']
 */

/**
 * Fetch a URL and write the contents to the virtual filesystem under
 * `/code/`. Only the filename is kept — directory structure in the URL
 * is not preserved. Use the `vfsPath` parameter for full control over
 * the destination path.
 *
 * Automatically detects binary files by extension (`.wav`, `.png`, `.wasm`, etc.).
 * If the file is a `.chug.wasm` ChuGin, it is loaded into the VM automatically.
 *
 * @function loadFile
 * @memberof ChucK
 * @instance
 * @param {string} url - URL to fetch.
 * @param {string} [vfsPath=/code/&lt;filename&gt;] - Destination VFS path.
 * @returns {Promise<string>} The VFS path where the file was written.
 * @example
 * var path = await ck.loadFile('./assets/click.wav');
 * // path === '/code/click.wav'
 *
 * // Explicit destination:
 * var path = await ck.loadFile('./assets/click.wav', '/code/sounds/click.wav');
 */

/**
 * Fetch multiple files from a base URL into `/code/`. The relative path
 * of each file is preserved, so subdirectories in the `files` array map
 * directly to subdirectories under `/code/`.
 *
 * Automatically detects binary files and `.chug.wasm` ChuGins.
 *
 * @function loadFiles
 * @memberof ChucK
 * @instance
 * @param {string} basePath - Base URL (e.g. `./assets/`).
 * @param {string[]} files - Filenames relative to basePath. Subdirectory
 *   paths are preserved (e.g. `'sfx/click.wav'` → `/code/sfx/click.wav`).
 * @returns {Promise<string[]>} Array of VFS paths.
 * @example
 * await ck.loadFiles('./assets/', ['click.wav', 'sfx/snare.wav', 'lib.ck']);
 * // VFS: /code/click.wav, /code/sfx/snare.wav, /code/lib.ck
 */

/**
 * Fetch a zip archive and extract all files to `/code/` in the virtual
 * filesystem. The zip's directory structure is preserved under `/code/`.
 * Automatically detects and loads any `.chug.wasm` ChuGins.
 *
 * Use {@link ChucK#listFiles} to inspect what was extracted.
 *
 * @function loadZip
 * @memberof ChucK
 * @instance
 * @param {string} url - URL of the zip file.
 * @returns {Promise<void>}
 * @example
 * await ck.loadZip('./assets.zip');
 * console.log(ck.listFiles()); // see what was extracted
 */

// ── Scalar Variables ────────────────────────────────────────────────────

/**
 * Set a global `int` variable in ChucK.
 *
 * @function setInt
 * @memberof ChucK
 * @instance
 * @param {string} name - Variable name.
 * @param {number} val - Integer value.
 * @example
 * ck.setInt('score', 42);
 */

/**
 * Set a global `float` variable in ChucK.
 *
 * @function setFloat
 * @memberof ChucK
 * @instance
 * @param {string} name - Variable name.
 * @param {number} val - Float value.
 * @example
 * ck.setFloat('gain', 0.5);
 */

/**
 * Set a global `string` variable in ChucK.
 *
 * @function setString
 * @memberof ChucK
 * @instance
 * @param {string} name - Variable name.
 * @param {string} val - String value.
 */

/**
 * Get a global `int` variable from ChucK.
 *
 * @function getInt
 * @memberof ChucK
 * @instance
 * @param {string} name - Variable name.
 * @returns {Promise<number>} The integer value.
 * @example
 * var score = await ck.getInt('score');
 */

/**
 * Get a global `float` variable from ChucK.
 *
 * @function getFloat
 * @memberof ChucK
 * @instance
 * @param {string} name - Variable name.
 * @returns {Promise<number>} The float value.
 */

/**
 * Get a global `string` variable from ChucK.
 *
 * @function getString
 * @memberof ChucK
 * @instance
 * @param {string} name - Variable name.
 * @returns {Promise<string>} The string value.
 */

// ── Events ──────────────────────────────────────────────────────────────

/**
 * Signal a global ChucK `Event`, waking one waiting shred.
 *
 * @function signalEvent
 * @memberof ChucK
 * @instance
 * @param {string} name - Event name.
 */

/**
 * Broadcast a global ChucK `Event`, waking all waiting shreds.
 *
 * @function broadcastEvent
 * @memberof ChucK
 * @instance
 * @param {string} name - Event name.
 * @example
 * ck.broadcastEvent('newData');
 */

/**
 * Listen for a global ChucK event. The callback fires each time
 * the event is broadcast or signaled.
 *
 * @function listenForEvent
 * @memberof ChucK
 * @instance
 * @param {string} name - Event name.
 * @param {Function} callback - Called each time the event fires.
 * @returns {number} Listener ID (pass to {@link ChucK#stopListeningForEvent}).
 * @example
 * var id = ck.listenForEvent('beat', function() {
 *     console.log('beat!');
 * });
 */

/**
 * Listen for a global ChucK event once. The callback fires on the
 * next occurrence and is then automatically removed.
 *
 * @function listenForEventOnce
 * @memberof ChucK
 * @instance
 * @param {string} name - Event name.
 * @param {Function} callback - Called once when the event fires.
 * @returns {number} Listener ID.
 */

/**
 * Stop listening for a global ChucK event.
 *
 * @function stopListeningForEvent
 * @memberof ChucK
 * @instance
 * @param {string} name - Event name.
 * @param {number} listenerId - The ID returned by {@link ChucK#listenForEvent}.
 */

/**
 * Alias for {@link ChucK#listenForEvent} (WebChucK API compatibility).
 *
 * @function startListeningForEvent
 * @memberof ChucK
 * @instance
 * @param {string} name - Event name.
 * @param {Function} callback - Called each time the event fires.
 * @returns {number} Listener ID.
 */

// ── Int Array Variables ─────────────────────────────────────────────────

/**
 * Set a global `int[]` array in ChucK.
 *
 * @function setIntArray
 * @memberof ChucK
 * @instance
 * @param {string} name - Array variable name.
 * @param {number[]} arr - Array of integer values.
 */

/**
 * Get a global `int[]` array from ChucK.
 *
 * @function getIntArray
 * @memberof ChucK
 * @instance
 * @param {string} name - Array variable name.
 * @returns {Promise<number[]>} The integer array.
 */

/**
 * Set an element in a global `int[]` array.
 *
 * @function setIntArrayValue
 * @memberof ChucK
 * @instance
 * @param {string} name - Array variable name.
 * @param {number} index - Array index.
 * @param {number} value - Integer value.
 */

/**
 * Get an element from a global `int[]` array.
 *
 * @function getIntArrayValue
 * @memberof ChucK
 * @instance
 * @param {string} name - Array variable name.
 * @param {number} index - Array index.
 * @returns {Promise<number>} The integer value at the given index.
 */

/**
 * Set an entry in a global associative `int` array (`int[string]`).
 *
 * @function setAssocIntArrayValue
 * @memberof ChucK
 * @instance
 * @param {string} name - Array variable name.
 * @param {string} key - Associative key.
 * @param {number} value - Integer value.
 */

/**
 * Get an entry from a global associative `int` array (`int[string]`).
 *
 * @function getAssocIntArrayValue
 * @memberof ChucK
 * @instance
 * @param {string} name - Array variable name.
 * @param {string} key - Associative key.
 * @returns {Promise<number>} The integer value.
 */

// ── Float Array Variables ───────────────────────────────────────────────

/**
 * Set a global `float[]` array in ChucK.
 *
 * @function setFloatArray
 * @memberof ChucK
 * @instance
 * @param {string} name - Array variable name.
 * @param {number[]} arr - Array of float values.
 */

/**
 * Get a global `float[]` array from ChucK.
 *
 * @function getFloatArray
 * @memberof ChucK
 * @instance
 * @param {string} name - Array variable name.
 * @returns {Promise<number[]>} The float array.
 */

/**
 * Set an element in a global `float[]` array.
 *
 * @function setFloatArrayValue
 * @memberof ChucK
 * @instance
 * @param {string} name - Array variable name.
 * @param {number} index - Array index.
 * @param {number} value - Float value.
 */

/**
 * Get an element from a global `float[]` array.
 *
 * @function getFloatArrayValue
 * @memberof ChucK
 * @instance
 * @param {string} name - Array variable name.
 * @param {number} index - Array index.
 * @returns {Promise<number>} The float value at the given index.
 */

/**
 * Set an entry in a global associative `float` array (`float[string]`).
 *
 * @function setAssocFloatArrayValue
 * @memberof ChucK
 * @instance
 * @param {string} name - Array variable name.
 * @param {string} key - Associative key.
 * @param {number} value - Float value.
 */

/**
 * Get an entry from a global associative `float` array (`float[string]`).
 *
 * @function getAssocFloatArrayValue
 * @memberof ChucK
 * @instance
 * @param {string} name - Array variable name.
 * @param {string} key - Associative key.
 * @returns {Promise<number>} The float value.
 */

// ── ChuGin & Package Loading ────────────────────────────────────────────

/**
 * Fetch and load a `.chug.wasm` ChuGin (ChucK plugin).
 *
 * @function loadChugin
 * @memberof ChucK
 * @instance
 * @param {string} url - URL of the `.chug.wasm` file.
 * @returns {Promise<string>} The ChuGin name (e.g. `"DMX"`).
 * @example
 * await ck.loadChugin('./chugins/DMX.chug.wasm');
 */

/**
 * Get the names of all currently loaded ChuGins.
 *
 * @function getLoadedChugins
 * @memberof ChucK
 * @instance
 * @returns {string[]} Array of ChuGin names (e.g. `['DMX', 'NHHall']`).
 * @example
 * await ck.loadChugin('./chugins/DMX.chug.wasm');
 * console.log(ck.getLoadedChugins()); // ['DMX']
 */

/**
 * Load a ChuMP package from the registry or a direct URL.
 *
 * @function loadPackage
 * @memberof ChucK
 * @instance
 * @param {string} name - Package name.
 * @param {string} [version='latest'] - Package version.
 * @param {string} [url] - Direct URL to the package zip (skips registry lookup).
 * @returns {Promise<string>} The package name.
 * @example
 * await ck.loadPackage('ChuGUI');
 */

// ── Audio ───────────────────────────────────────────────────────────────

/**
 * Fetch an audio file, decode it to WAV, and write it to the virtual
 * filesystem so ChucK can play it with `SndBuf`.
 *
 * @function loadAudio
 * @memberof ChucK
 * @instance
 * @param {string} url - URL of the audio file (any format the browser can decode).
 * @param {string} [vfsPath] - Destination VFS path. Defaults to `/audio/<filename>`.
 * @returns {Promise<string>} The VFS path where the WAV was written.
 * @example
 * var path = await ck.loadAudio('./samples/kick.mp3');
 * ck.setString('samplePath', path);
 */

/**
 * Initialize MIDI input/output with a Web MIDI API `MIDIAccess` object.
 *
 * @function initMidi
 * @memberof ChucK
 * @instance
 * @param {MIDIAccess} access - The `MIDIAccess` object from `navigator.requestMIDIAccess()`.
 * @example
 * var access = await navigator.requestMIDIAccess();
 * ck.initMidi(access);
 */

/**
 * Get the audio sample rate. Returns `null` if audio hasn't initialized yet.
 *
 * @function getSampleRate
 * @memberof ChucK
 * @instance
 * @returns {number|null} Sample rate in Hz (e.g. `48000`), or `null`.
 * @example
 * console.log(ck.getSampleRate()); // 48000
 */

/**
 * The `AudioContext` used by WebChuGL. `null` until the audio system
 * initializes (after `ChuGL.init()` resolves and user interaction occurs).
 *
 * @member {AudioContext} audioContext
 * @memberof ChucK
 * @instance
 */

/**
 * The `AudioWorkletNode` running the ChucK audio engine. `null` until
 * the audio system initializes. Connect to this node to tap into
 * WebChuGL's audio output (e.g. for recording or visualization).
 *
 * @member {AudioWorkletNode} audioNode
 * @memberof ChucK
 * @instance
 */

// ── VM Introspection ────────────────────────────────────────────────────

/**
 * Get the current ChucK time (`now`) in samples. Divide by the sample
 * rate to convert to seconds.
 *
 * @function getCurrentTime
 * @memberof ChucK
 * @instance
 * @returns {number} Current time in samples.
 * @example
 * var samples = ck.getCurrentTime();
 * var seconds = samples / ck.getSampleRate();
 */

/**
 * Get all active shreds (running and blocked) in the ChucK VM.
 *
 * @function getActiveShreds
 * @memberof ChucK
 * @instance
 * @returns {Array<{id: number, name: string}>} Array of shred objects.
 * @example
 * var shreds = ck.getActiveShreds();
 * // [{ id: 1, name: "main.ck" }, { id: 3, name: "helper.ck" }]
 */

/**
 * Get the error output from the last failed compilation. Call this
 * after {@link ChucK#runCode} or {@link ChucK#runFile} returns `0`
 * to retrieve the compiler error message.
 *
 * @function getLastError
 * @memberof ChucK
 * @instance
 * @returns {string} The error message, or an empty string if no error.
 * @example
 * var result = await ck.runCode('invalid code!!!');
 * if (!result) {
 *     console.error(ck.getLastError());
 * }
 */

/**
 * Get all global variables currently declared in the ChucK VM.
 *
 * @function getGlobalVariables
 * @memberof ChucK
 * @instance
 * @returns {Array<{type: string, name: string}>} Array of variable descriptors.
 * @example
 * var globals = ck.getGlobalVariables();
 * // [{ type: "int", name: "score" }, { type: "float", name: "gain" }]
 */

// ── Persistent Storage (IndexedDB) ──────────────────────────────────────

/**
 * Save a value to IndexedDB (persists across sessions).
 *
 * @function save
 * @memberof ChucK
 * @instance
 * @param {string} key - Storage key.
 * @param {*} value - Any serializable value.
 * @returns {Promise<void>}
 */

/**
 * Load a value from IndexedDB.
 *
 * @function load
 * @memberof ChucK
 * @instance
 * @param {string} key - Storage key.
 * @returns {Promise<*>} The stored value, or `undefined` if not found.
 */

/**
 * Delete a value from IndexedDB.
 *
 * @function delete
 * @memberof ChucK
 * @instance
 * @param {string} key - Storage key.
 * @returns {Promise<void>}
 */

/**
 * List all keys in IndexedDB storage.
 *
 * @function listKeys
 * @memberof ChucK
 * @instance
 * @returns {Promise<string[]>} Array of stored keys.
 */

// ============================================================================
// ChuGL — initialization
// ============================================================================

var _initPromise = null;

function _loadScript(url) {
    return new Promise(function(resolve, reject) {
        var s = document.createElement('script');
        s.src = url;
        s.onload = resolve;
        s.onerror = function() { reject(new Error('Failed to load: ' + url)); };
        document.head.appendChild(s);
    });
}

/**
 * The ChuGL entry point. Call {@link ChuGL.init} to create a
 * {@link ChucK} instance.
 *
 * @namespace ChuGL
 * @example
 * import ChuGL from 'https://cdn.jsdelivr.net/npm/webchugl/+esm';
 *
 * var ck = await ChuGL.init({
 *     canvas: document.getElementById('canvas'),
 * });
 */
var ChuGL = {
    /**
     * Initialize WebChuGL and return a {@link ChucK} instance.
     * Only one instance is supported — calling `init()` a second time
     * returns a rejected promise.
     *
     * @function init
     * @memberof ChuGL
     * @static
     * @param {Object} config - Configuration options.
     * @param {HTMLCanvasElement} config.canvas - **Required.** Canvas element for WebGPU rendering.
     * @param {string} [config.whereIsChuGL] - Base URL where WebChuGL runtime
     *   assets are hosted (`index.js`, `index.wasm`, `audio-worklet-processor.js`,
     *   `jszip.min.js`). Must end with `/`. Defaults to the CCRMA-hosted runtime.
     * @param {string[]} [config.chugins] - Array of URLs to `.chug.wasm` files
     *   to load before the VM starts. Fetched in parallel with WebGPU init.
     * @param {boolean} [config.serviceWorker=true] - Register a service worker
     *   that injects COOP/COEP headers for cross-origin isolation. Set to
     *   `false` if your server already sends these headers.
     * @param {Object} [config.audioConfig] - Audio configuration.
     * @param {number} [config.audioConfig.sampleRate=48000] - Audio sample rate.
     * @param {number} [config.audioConfig.outputChannels=2] - Number of output channels.
     * @param {number} [config.audioConfig.inputChannels=2] - Number of input channels.
     * @param {Function} [config.onProgress] - Progress callback, receives 0–100.
     * @param {Function} [config.onError] - Error callback, receives a message string.
     * @param {Function} [config.onReady] - Called when WebGPU init completes and
     *   the canvas is ready for rendering.
     * @returns {Promise<ChucK>} Resolves to a {@link ChucK} instance.
     * @example
     * var ck = await ChuGL.init({
     *     canvas: document.getElementById('canvas'),
     *     chugins: ['./chugins/Bitcrusher.chug.wasm'],
     *     audioConfig: { sampleRate: 44100 },
     * });
     */
    init: function(config) {
        if (_initPromise) {
            return Promise.reject(new Error('ChuGL.init() has already been called. Only one instance is supported.'));
        }
        if (!config || !config.canvas) {
            return Promise.reject(new Error('ChuGL.init() requires config.canvas'));
        }

        var baseUrl = config.whereIsChuGL || 'https://ccrma.stanford.edu/webchugl/src/';
        if (baseUrl[baseUrl.length - 1] !== '/') baseUrl += '/';

        // Validate baseUrl scheme to prevent loading scripts from untrusted origins
        if (baseUrl.indexOf('://') !== -1 && baseUrl.indexOf('https://') !== 0 && baseUrl.indexOf('http://localhost') !== 0 && baseUrl.indexOf('http://127.0.0.1') !== 0) {
            return Promise.reject(new Error('ChuGL.init(): whereIsChuGL must use https:// (or http://localhost for development)'));
        }

        // Warn if cross-origin isolation is missing
        if (!window.crossOriginIsolated) {
            console.warn(
                '[WebChuGL] window.crossOriginIsolated is false. ' +
                'SharedArrayBuffer (required for audio) may not be available. ' +
                'Ensure your server sends COOP/COEP headers.'
            );
        }

        _initPromise = _loadScript(baseUrl + 'index.js')
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
            })
            .catch(function(e) {
                _initPromise = null;
                throw e;
            });

        return _initPromise;
    }
};

export default ChuGL;
export { ChuGL };
