// WebChuGL Runtime
// Call _initWebChuGL(config) to initialize. Returns Promise<ChucK> bridge object.

// ============================================================================
// Non-standard API extensions (iOS Safari sensor permissions, MIDI internals)
// ============================================================================

interface DeviceMotionEventWithPermission {
    requestPermission(): Promise<'granted' | 'denied'>;
}

interface DeviceOrientationEventWithPermission {
    requestPermission(): Promise<'granted' | 'denied'>;
}

interface RtMidiWindow extends Window {
    _rtmidi_internals_midi_access: MIDIAccess;
    _rtmidi_internals_latest_message_timestamp: number;
    _rtmidi_internals_waiting: boolean;
    _rtmidi_internals_get_port_by_number: (portNumber: number, isInput: boolean) => MIDIPort | null;
}

// ============================================================================
// Sensor data shapes
// ============================================================================

interface AccelReading {
    x: number;
    y: number;
    z: number;
}

interface GyroReading {
    alpha: number;
    beta: number;
    gamma: number;
}

// ============================================================================
// Globals (set during initialization)
// ============================================================================

let _module: EmscriptenModule | null = null;

// ============================================================================
// Utility helpers (pure functions, no side effects)
// ============================================================================

const _binaryExts = /\.(wasm|wav|mp3|ogg|flac|aiff|aif|png|jpg|jpeg|gif|bmp|webp|tga|hdr|obj|mtl|glb|gltf|bin|dat|zip)$/i;

function _isBinaryFile(path: string): boolean {
    return _binaryExts.test(path);
}

function _ensureVfsDir(path: string): void {
    const parts = path.split('/').slice(0, -1);
    let current = '';
    for (let i = 0; i < parts.length; i++) {
        if (!parts[i]) continue;
        current += '/' + parts[i];
        try { _module!.FS.mkdir(current); } catch(e) { /* directory may already exist */ }
    }
}

function _writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}

function _audioBufferToWav(audioBuffer: AudioBuffer): ArrayBuffer {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const numSamples = audioBuffer.length;
    const blockAlign = numChannels * 2;
    const dataSize = numSamples * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    _writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    _writeString(view, 8, 'WAVE');
    _writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    _writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    const channels: Float32Array[] = [];
    for (let ch = 0; ch < numChannels; ch++) {
        channels.push(audioBuffer.getChannelData(ch));
    }

    let dataOffset = 44;
    for (let i = 0; i < numSamples; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
            const sample = Math.max(-1, Math.min(1, channels[ch][i]));
            view.setInt16(dataOffset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            dataOffset += 2;
        }
    }

    return buffer;
}

// ============================================================================
// Persistent Storage (IndexedDB) — lazy-initialized
// ============================================================================

let _ckDBReady: Promise<IDBDatabase> | null = null;

function _getDB(): Promise<IDBDatabase> {
    if (_ckDBReady) return _ckDBReady;
    _ckDBReady = new Promise<IDBDatabase>(function(resolve, reject) {
        const request = indexedDB.open('WebChuGL', 1);
        request.onupgradeneeded = function() {
            const db = request.result;
            if (!db.objectStoreNames.contains('kv')) {
                db.createObjectStore('kv');
            }
        };
        request.onsuccess = function() { resolve(request.result); };
        request.onerror = function() {
            console.error('[WebChuGL] IndexedDB error:', request.error);
            _ckDBReady = null; // allow retry on next call
            reject(request.error);
        };
    });
    return _ckDBReady;
}

// ============================================================================
// Device Sensors (Accelerometer + Gyroscope)
// ============================================================================

interface SensorCK {
    setFloat(name: string, val: number): void;
    broadcastEvent(name: string): void;
}

function _initSensors(ck: SensorCK): void {
    let accelPending: AccelReading | null = null;
    let gyroPending: GyroReading | null = null;

    // Gamepad/joystick input is now handled natively by emscripten-glfw's
    // built-in joystick support (polled via glfwPollEvents in the render loop).

    function flushSensors(): void {
        if (!_module) return; // guard: stop if WASM torn down (do NOT re-schedule)
        if (accelPending) {
            ck.setFloat('_accelX', accelPending.x);
            ck.setFloat('_accelY', accelPending.y);
            ck.setFloat('_accelZ', accelPending.z);
            ck.broadcastEvent('_accelReading');
            accelPending = null;
        }
        if (gyroPending) {
            ck.setFloat('_gyroX', gyroPending.alpha);
            ck.setFloat('_gyroY', gyroPending.beta);
            ck.setFloat('_gyroZ', gyroPending.gamma);
            ck.broadcastEvent('_gyroReading');
            gyroPending = null;
        }
        requestAnimationFrame(flushSensors);
    }
    requestAnimationFrame(flushSensors);

    // Accelerometer
    if (window.DeviceMotionEvent) {
        const handleMotion = function(e: DeviceMotionEvent): void {
            const a = e.accelerationIncludingGravity;
            if (!a) return;
            accelPending = { x: a.x || 0, y: a.y || 0, z: a.z || 0 };
        };

        const DME = DeviceMotionEvent as unknown as DeviceMotionEventWithPermission;
        if (typeof DME.requestPermission === 'function') {
            const requestAccelPermission = function(): void {
                DME.requestPermission().then(function(state) {
                    if (state === 'granted') {
                        window.addEventListener('devicemotion', handleMotion);
                    }
                }).catch(function() { /* permission denied or unavailable */ });
            };
            document.addEventListener('click', requestAccelPermission, { once: true });
            document.addEventListener('touchend', requestAccelPermission, { once: true });
        } else {
            window.addEventListener('devicemotion', handleMotion);
        }
    }

    // Gyroscope
    if (window.DeviceOrientationEvent) {
        const handleOrientation = function(e: DeviceOrientationEvent): void {
            gyroPending = { alpha: e.alpha || 0, beta: e.beta || 0, gamma: e.gamma || 0 };
        };

        const DOE = DeviceOrientationEvent as unknown as DeviceOrientationEventWithPermission;
        if (typeof DOE.requestPermission === 'function') {
            const requestGyroPermission = function(): void {
                DOE.requestPermission().then(function(state) {
                    if (state === 'granted') {
                        window.addEventListener('deviceorientation', handleOrientation);
                    }
                }).catch(function() { /* permission denied or unavailable */ });
            };
            document.addEventListener('click', requestGyroPermission, { once: true });
            document.addEventListener('touchend', requestGyroPermission, { once: true });
        } else {
            window.addEventListener('deviceorientation', handleOrientation);
        }
    }
}

// ============================================================================
// Service Worker Registration (COOP/COEP headers + offline caching)
// ============================================================================

// Returns true if a page reload was triggered (caller should abort init).
function _registerServiceWorker(swUrl: string): boolean {
    if (!('serviceWorker' in navigator)) return false;

    // Already cross-origin isolated — SW is working, nothing to do
    if (window.crossOriginIsolated) {
        sessionStorage.removeItem('webchugl-sw-reload');
        return false;
    }

    if (!window.isSecureContext) {
        console.log('[WebChuGL] Service worker requires a secure context (HTTPS or localhost).');
        return false;
    }

    // Ensure the SW is registered (starts install on first visit,
    // checks for updates otherwise). Fire-and-forget.
    navigator.serviceWorker.register(swUrl).catch(function(err: Error) {
        console.error('[WebChuGL] Service worker registration failed:', err);
    });

    // On force-reload (Ctrl+Shift+R) or first visit, the browser sets
    // navigator.serviceWorker.controller to null — the SW cannot control
    // that navigation request.  A normal location.reload() will go through
    // the (now-registered) SW, which injects COOP/COEP headers.
    if (!navigator.serviceWorker.controller) {
        const key = 'webchugl-sw-reload';
        const count = parseInt(sessionStorage.getItem(key) || '0', 10);
        if (count < 2) {
            sessionStorage.setItem(key, String(count + 1));
            location.reload();
            return true;
        }
        // Gave up after 2 reloads — proceed without isolation.
        // The controllerchange listener below will still reload if
        // the SW activates later (e.g., slow first-visit install).
        console.warn('[WebChuGL] crossOriginIsolated is still false after ' + count + ' reloads. Giving up.');
        sessionStorage.removeItem(key);
    }

    // Reload when a new SW becomes the controller (covers fresh installs
    // that finish after the counter expired, and SW updates).
    navigator.serviceWorker.addEventListener('controllerchange', function() {
        if (!window.crossOriginIsolated) location.reload();
    }, { once: true });

    return false;
}

// ============================================================================
// Main Initialization
// ============================================================================
//
// config = {
//   canvas:           HTMLCanvasElement  (required)
//   baseUrl:          string             (default: 'webchugl/')
//   audioConfig:      { sampleRate, outputChannels, inputChannels }
//   onProgress:       function(pct)      (loading progress 0-100)
//   onError:          function(msg)      (error display)
//   onReady:          function()         (called when init complete)
// }
//
// Returns: Promise<CK>

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- called from webchugl-esm.ts via <script> tag
function _initWebChuGL(config: WebChuGLInternalConfig): Promise<ChucK> {
    let _baseUrl: string = config.baseUrl || 'webchugl/';
    if (_baseUrl[_baseUrl.length - 1] !== '/') _baseUrl += '/';
    const _canvas: HTMLCanvasElement = config.canvas;
    const _chuginUrls: string[] = config.chugins || [];
    const _loadedChugins: Record<string, boolean> = {};
    const _onProgress: (pct: number) => void = config.onProgress || function() {};
    const _onError: (msg: string) => void = config.onError || function(msg: string) { console.error('[WebChuGL] ' + msg); };
    const _onReady: () => void = config.onReady || function() {};

    // Lazy-load JSZip (shared across loadZip, runZip, loadPackage)
    let _jszipPromise: Promise<void> | null = null;
    function _ensureJSZip(): Promise<void> {
        if (typeof JSZip !== 'undefined') return Promise.resolve();
        if (_jszipPromise) return _jszipPromise;
        _jszipPromise = new Promise<void>(function(resolve, reject) {
            const s = document.createElement('script');
            s.src = _baseUrl + 'jszip.min.js';
            s.onload = function() { resolve(); };
            s.onerror = function() { reject(new Error('Failed to load jszip')); };
            document.head.appendChild(s);
        });
        return _jszipPromise;
    }

    // Load a .chug.wasm that's already in the VFS. Returns the short name, or null on failure.
    function _loadChuginFromVfs(vfsPath: string): string | null {
        const filename = vfsPath.split('/').pop()!;
        const shortName = filename.replace('.chug.wasm', '');
        if (_loadedChugins[shortName]) return shortName;
        const result = _module!.ccall('ck_load_chugin', 'number', ['string'], [vfsPath]);
        if (result) {
            _loadedChugins[shortName] = true;
            return shortName;
        }
        return null;
    }

    // ── Service Worker ──────────────────────────────────────────────────
    if (config.serviceWorker !== false) {
        const reloadPending = _registerServiceWorker(config.serviceWorkerUrl || './sw.js');
        if (reloadPending) {
            // Page will reload for cross-origin isolation — don't start WASM init
            return new Promise<ChucK>(function() {});
        }
    }

    // ── Audio Config ────────────────────────────────────────────────────
    // Priority: defaults < URL params < init config.audioConfig
    const _audioConfig: WebChuGLAudioConfig = (function(): WebChuGLAudioConfig {
        const defaults: WebChuGLAudioConfig = { sampleRate: 48000, outChannels: 2, inChannels: 2 };
        const params = new URLSearchParams(window.location.search);
        const sr = parseInt(params.get('srate') || '', 10);
        const out = parseInt(params.get('out') || '', 10);
        const inp = parseInt(params.get('in') || '', 10);
        if (sr > 0) defaults.sampleRate = sr;
        if (out > 0) defaults.outChannels = out;
        if (inp > 0) defaults.inChannels = inp;
        const ac = config.audioConfig;
        if (ac) {
            if (ac.sampleRate && ac.sampleRate > 0) defaults.sampleRate = ac.sampleRate;
            if (ac.outputChannels && ac.outputChannels > 0) defaults.outChannels = ac.outputChannels;
            if (ac.inputChannels && ac.inputChannels > 0) defaults.inChannels = ac.inputChannels;
        }
        return defaults;
    })();

    // ── Audio state (closure-scoped) ────────────────────────────────────
    let _audioCtx: AudioContext | null = null;
    let _audioNode: AudioWorkletNode | null = null;

    // ── Module Config ───────────────────────────────────────────────────
    const _moduleConfig: Partial<EmscriptenModule> & {
        _ckCallbacks: Record<number, (value: any) => void>;
        _ckEventListeners: Record<number, CkEventListenerEntry>;
        _onChuckPrint?: ((text: string) => void) | null;
    } = {
        noInitialRun: true,

        _audioConfig: _audioConfig,

        canvas: (function(): HTMLCanvasElement {
            _canvas.addEventListener('webglcontextlost', function(e: Event) {
                e.preventDefault();
            }, false);
            return _canvas;
        })(),

        locateFile: function(path: string): string {
            if (path === 'index.wasm') path = 'webchugl.wasm';
            return _baseUrl + path;
        },

        print: function(text: string): void {
            if (_moduleConfig._onChuckPrint) {
                _moduleConfig._onChuckPrint(text);
            } else {
                console.log(text);
            }
        },

        printErr: function(text: string): void {
            console.error(text);
        },

        setStatus: function(): void {},

        _ckCallbacks: {} as Record<number, (value: any) => void>,
        _ckEventListeners: {} as Record<number, CkEventListenerEntry>,

        // Called from C++ initAudio() via EM_ASM
        _initAudio: function(
            sab: SharedArrayBuffer,
            outBufPtr: number,
            outWritePosPtr: number,
            outReadPosPtr: number,
            inBufPtr: number,
            inWritePosPtr: number,
            inReadPosPtr: number,
            capacity: number,
            needsMic: number,
            sampleRate: number,
            outChannels: number,
            inChannels: number
        ): void {
            let ctx: AudioContext;
            try {
                ctx = new AudioContext({ sampleRate: sampleRate, latencyHint: 'interactive' });
            } catch (e) {
                console.error('[WebChuGL] Failed to create AudioContext: ' + (e as Error).message);
                return;
            }

            ctx.audioWorklet.addModule(_baseUrl + 'audio-worklet-processor.js').then(function() {
                const node = new AudioWorkletNode(ctx, 'chuck-processor', {
                    numberOfInputs: 1,
                    numberOfOutputs: 1,
                    outputChannelCount: [outChannels],
                    channelCount: inChannels,
                    channelCountMode: 'explicit'
                });

                node.port.postMessage({
                    sab: sab,
                    outBufOffset: outBufPtr,
                    outWritePosOffset: outWritePosPtr,
                    outReadPosOffset: outReadPosPtr,
                    inBufOffset: inBufPtr,
                    inWritePosOffset: inWritePosPtr,
                    inReadPosOffset: inReadPosPtr,
                    capacity: capacity,
                    outChannels: outChannels,
                    inChannels: inChannels
                });

                node.connect(ctx.destination);

                _audioCtx = ctx;
                _audioNode = node;

                if (needsMic) {
                    navigator.mediaDevices.getUserMedia({ audio: true })
                        .then(function(stream: MediaStream) {
                            const source = ctx.createMediaStreamSource(stream);
                            source.connect(node);
                            console.log('[WebChuGL] Microphone connected');
                        })
                        .catch(function(err: Error) {
                            console.log('[WebChuGL] Microphone not available: ' + err.message);
                        });
                }

                // Resume AudioContext on user interaction
                function removeStartAudio(): void {
                    document.removeEventListener('click', startAudio);
                    document.removeEventListener('keydown', startAudio);
                    document.removeEventListener('touchstart', startAudio);
                }
                const startAudio = function(): void {
                    if (ctx.state === 'running') {
                        removeStartAudio();
                        return;
                    }
                    ctx.resume().then(removeStartAudio).catch(function(err: Error) {
                        console.warn('[WebChuGL] AudioContext resume failed:', err);
                        removeStartAudio();
                    });
                };
                document.addEventListener('click', startAudio);
                document.addEventListener('keydown', startAudio);
                document.addEventListener('touchstart', startAudio);

                console.log('[WebChuGL] Audio initialized (JS AudioWorklet)');
            }).catch(function(err: Error) {
                console.error('[WebChuGL] Audio worklet failed: ' + err.message);
            });
        },

        preRun: [function(mod: EmscriptenModule): void {
            _module = mod;
            _ensureVfsDir('/code');
            _onProgress(100);
        }]
    };

    // ── CK Bridge ───────────────────────────────────────────────────────
    let _ckNextId = 1;
    let _ckReady = false;
    let _ckQueue: Array<() => void> = [];
    function _ckDefer(fn: () => void): void {
        if (_ckReady) fn();
        else _ckQueue.push(fn);
    }

    function _ckDeferPromise<T>(fn: () => Promise<T>): Promise<T> {
        if (_ckReady) {
            try { return fn(); }
            catch (e) { return Promise.reject(e); }
        }
        return new Promise<T>(function(resolve, reject) {
            _ckQueue.push(function() {
                try { fn().then(resolve, reject); }
                catch (e) { reject(e); }
            });
        });
    }

    function _ckFlush(): void {
        _ckReady = true;
        for (let i = 0; i < _ckQueue.length; i++) _ckQueue[i]();
        _ckQueue = [];
    }

    // Settle all pending _ckGet callbacks (e.g., on VM reset or teardown).
    // Resolves with undefined so hanging promises settle rather than leak.
    function _ckFlushCallbacks(): void {
        const cbs = _moduleConfig._ckCallbacks;
        const keys = Object.keys(cbs);
        for (let i = 0; i < keys.length; i++) {
            const numKey = Number(keys[i]);
            cbs[numKey](undefined);
            delete cbs[numKey];
        }
    }

    function _ckSet(func: string, types: string[], args: unknown[]): void {
        _ckDefer(function() {
            _module!.ccall(func, 'number', types, args);
        });
    }

    function _ckGet(func: string, types: string[], args: unknown[]): Promise<any> {
        return _ckDeferPromise(function() {
            return new Promise(function(resolve, reject) {
                const id = _ckNextId++;
                _moduleConfig._ckCallbacks[id] = resolve;
                const ret = _module!.ccall(func, 'number', types.concat('number'), args.concat(id));
                if (!ret) {
                    delete _moduleConfig._ckCallbacks[id];
                    reject(new Error(func + ' failed'));
                }
            });
        });
    }

    const CK: ChucK = {

        // ── Audio access (null until audio system initializes) ────────
        get audioContext(): AudioContext | null { return _audioCtx; },
        get audioNode(): AudioWorkletNode | null { return _audioNode; },

        getSampleRate: function(): number | null {
            return _audioCtx ? _audioCtx.sampleRate : null;
        },

        // ── VM Introspection ────────────────────────────────────────────

        getCurrentTime: function(): number {
            if (!_module) return 0;
            return _module.ccall('ck_get_now', 'number', [], []);
        },

        getActiveShreds: function(): ShredInfo[] {
            if (!_module) return [];
            const json: string = _module.ccall('ck_get_active_shreds', 'string', [], []);
            try { return JSON.parse(json); } catch(e) { return []; }
        },

        getLastError: function(): string {
            if (!_module) return '';
            return _module.ccall('ck_get_last_compile_output', 'string', [], []);
        },

        getGlobalVariables: function(): GlobalVariableInfo[] {
            if (!_module) return [];
            const json: string = _module.ccall('ck_get_all_globals', 'string', [], []);
            try { return JSON.parse(json); } catch(e) { return []; }
        },

        // ── Code execution ─────────────────────────────────────────────

        runCode: function(code: string): Promise<number> {
            return _ckDeferPromise(function() {
                return Promise.resolve(
                    _module!.ccall('ck_run_code', 'number', ['string'], [code])
                );
            });
        },

        runFile: function(pathOrUrl: string): Promise<number> {
            if (pathOrUrl[0] === '/') {
                // VFS path — run directly
                return _ckDeferPromise(function() {
                    return Promise.resolve(
                        _module!.ccall('ck_run_file', 'number', ['string'], [pathOrUrl])
                    );
                });
            }
            // Check if already in VFS at /code/<name> before fetching
            const parts = pathOrUrl.split('/');
            const filename = parts[parts.length - 1];
            const vfsCheck = '/code/' + filename;
            try {
                _module!.FS.stat(vfsCheck);
                // File exists in VFS — run directly
                return _ckDeferPromise(function() {
                    return Promise.resolve(
                        _module!.ccall('ck_run_file', 'number', ['string'], [vfsCheck])
                    );
                });
            } catch (e) {
                // Not in VFS — fetch as URL, then run
                return CK.loadFile(pathOrUrl).then(function(vfsPath: string) {
                    return _ckDeferPromise(function() {
                        return Promise.resolve(
                            _module!.ccall('ck_run_file', 'number', ['string'], [vfsPath])
                        );
                    });
                });
            }
        },

        createFile: function(dirOrPath: string, filenameOrData: string | ArrayBuffer, maybeData?: string | ArrayBuffer): void {
            let path: string;
            let data: string | ArrayBuffer;
            if (maybeData !== undefined) {
                // WebChucK style: createFile(directory, filename, data)
                let dir = dirOrPath;
                if (dir && dir[dir.length - 1] !== '/') dir += '/';
                path = dir + (filenameOrData as string);
                data = maybeData;
            } else {
                // WebChuGL style: createFile(path, data)
                path = dirOrPath;
                data = filenameOrData;
            }
            _ckDefer(function() {
                _ensureVfsDir(path);
                if (typeof data === 'string') {
                    _module!.FS.writeFile(path, data);
                } else {
                    _module!.FS.writeFile(path, new Uint8Array(data));
                }
            });
        },

        removeFile: function(path: string): boolean {
            try {
                const stat = _module!.FS.stat(path);
                if (_module!.FS.isDir(stat.mode)) {
                    // Recursive directory removal
                    const entries = _module!.FS.readdir(path).filter(function(e: string) { return e !== '.' && e !== '..'; });
                    for (let i = 0; i < entries.length; i++) {
                        CK.removeFile(path + '/' + entries[i]);
                    }
                    _module!.FS.rmdir(path);
                } else {
                    _module!.FS.unlink(path);
                }
                return true;
            } catch (e) {
                return false;
            }
        },

        fileExists: function(path: string): boolean {
            try {
                _module!.FS.stat(path);
                return true;
            } catch (e) {
                return false;
            }
        },

        listFiles: function(dir?: string): string[] {
            const baseDir = dir || '/code';
            function walk(d: string): string[] {
                let results: string[] = [];
                let entries: string[];
                try {
                    entries = _module!.FS.readdir(d);
                } catch (e) {
                    return results;
                }
                for (let i = 0; i < entries.length; i++) {
                    if (entries[i] === '.' || entries[i] === '..') continue;
                    const full = d + '/' + entries[i];
                    const stat = _module!.FS.stat(full);
                    if (_module!.FS.isDir(stat.mode)) {
                        results = results.concat(walk(full));
                    } else {
                        results.push(full);
                    }
                }
                return results;
            }
            return walk(baseDir);
        },

        loadFile: function(url: string, vfsPath?: string): Promise<string> {
            let resolvedPath = vfsPath;
            if (!resolvedPath) {
                const parts = url.split('/');
                resolvedPath = '/code/' + parts[parts.length - 1];
            }
            if (resolvedPath[0] !== '/') resolvedPath = '/' + resolvedPath;
            const isBinary = _isBinaryFile(resolvedPath);
            const isChugin = resolvedPath.endsWith('.chug.wasm');
            const finalPath = resolvedPath;
            return fetch(url)
                .then(function(response: Response): Promise<string | ArrayBuffer> {
                    if (!response.ok) throw new Error('Failed to fetch ' + url);
                    return isBinary ? response.arrayBuffer() : response.text();
                })
                .then(function(data: string | ArrayBuffer) {
                    _ckDefer(function() {
                        _ensureVfsDir(finalPath);
                        _module!.FS.writeFile(finalPath, isBinary ? new Uint8Array(data as ArrayBuffer) : data as string);
                        if (isChugin) _loadChuginFromVfs(finalPath);
                    });
                    return finalPath;
                });
        },

        loadFiles: function(basePath: string, files: string[]): Promise<string[]> {
            if (basePath[basePath.length - 1] !== '/') basePath += '/';
            return Promise.all(files.map(function(file: string) {
                const url = basePath + file;
                const vfsPath = '/code/' + file;
                const isBinary = _isBinaryFile(file);
                const isChugin = file.endsWith('.chug.wasm');
                return fetch(url)
                    .then(function(response: Response): Promise<string | ArrayBuffer> {
                        if (!response.ok) throw new Error('Failed to fetch ' + url);
                        return isBinary ? response.arrayBuffer() : response.text();
                    })
                    .then(function(data: string | ArrayBuffer) {
                        _ckDefer(function() {
                            _ensureVfsDir(vfsPath);
                            _module!.FS.writeFile(vfsPath, isBinary ? new Uint8Array(data as ArrayBuffer) : data as string);
                            if (isChugin) _loadChuginFromVfs(vfsPath);
                        });
                        return vfsPath;
                    });
            }));
        },

        loadZip: function(url: string): Promise<void> {
            const jszipReady = _ensureJSZip();
            return fetch(url)
                .then(function(response: Response) {
                    if (!response.ok) throw new Error('Failed to fetch ' + url);
                    return response.arrayBuffer();
                })
                .then(function(zipData: ArrayBuffer) {
                    return jszipReady.then(function() { return JSZip.loadAsync(zipData); });
                })
                .then(function(zip: JSZipObject) {
                    const entries = Object.keys(zip.files).filter(function(name: string) {
                        return !zip.files[name].dir;
                    });
                    return Promise.all(entries.map(function(name: string) {
                        return zip.files[name].async('arraybuffer').then(function(content: ArrayBuffer) {
                            const vfsPath = '/code/' + name;
                            _ckDefer(function() {
                                _ensureVfsDir(vfsPath);
                                _module!.FS.writeFile(vfsPath, new Uint8Array(content));
                                if (name.endsWith('.chug.wasm')) _loadChuginFromVfs(vfsPath);
                            });
                        });
                    }));
                })
                .then(function() {
                    console.log('[WebChuGL] Zip extracted: ' + url);
                });
        },

        runZip: function(url: string, mainFile?: string): Promise<number> {
            let resolvedMainFile = mainFile;
            if (resolvedMainFile && resolvedMainFile[0] !== '/') resolvedMainFile = '/code/' + resolvedMainFile;
            const jszipReady = _ensureJSZip();
            return fetch(url)
                .then(function(response: Response) {
                    if (!response.ok) throw new Error('Failed to fetch ' + url);
                    return response.arrayBuffer();
                })
                .then(function(zipData: ArrayBuffer) {
                    return jszipReady.then(function() { return JSZip.loadAsync(zipData); });
                })
                .then(function(zip: JSZipObject) {
                    const entries = Object.keys(zip.files).filter(function(name: string) {
                        return !zip.files[name].dir;
                    });
                    // Auto-detect main file: prefer main.ck at root, else first root .ck
                    if (!resolvedMainFile) {
                        if (entries.indexOf('main.ck') !== -1) {
                            resolvedMainFile = '/code/main.ck';
                        } else {
                            const rootCk = entries.filter(function(n: string) {
                                return n.endsWith('.ck') && n.indexOf('/') === -1;
                            });
                            resolvedMainFile = rootCk.length ? '/code/' + rootCk[0] : '/code/main.ck';
                        }
                    }
                    return Promise.all(entries.map(function(name: string) {
                        return zip.files[name].async('arraybuffer').then(function(content: ArrayBuffer) {
                            const vfsPath = '/code/' + name;
                            _ckDefer(function() {
                                _ensureVfsDir(vfsPath);
                                _module!.FS.writeFile(vfsPath, new Uint8Array(content));
                                if (name.endsWith('.chug.wasm')) _loadChuginFromVfs(vfsPath);
                            });
                        });
                    }));
                })
                .then(function() {
                    return _ckDeferPromise(function() {
                        return Promise.resolve(
                            _module!.ccall('ck_run_file', 'number', ['string'], [resolvedMainFile!])
                        );
                    });
                });
        },

        // ── Scalar setters ─────────────────────────────────────────────

        setInt:    function(name: string, val: number): void { _ckSet('ck_set_int',    ['string', 'number'], [name, val]); },
        setFloat:  function(name: string, val: number): void { _ckSet('ck_set_float',  ['string', 'number'], [name, val]); },
        setString: function(name: string, val: string): void { _ckSet('ck_set_string', ['string', 'string'], [name, val]); },

        // ── Scalar getters (Promise-based) ─────────────────────────────

        getInt:    function(name: string): Promise<number> { return _ckGet('ck_get_int',    ['string'], [name]); },
        getFloat:  function(name: string): Promise<number> { return _ckGet('ck_get_float',  ['string'], [name]); },
        getString: function(name: string): Promise<string> { return _ckGet('ck_get_string', ['string'], [name]); },

        // ── Events ─────────────────────────────────────────────────────

        signalEvent:    function(name: string): void { _ckSet('ck_signal_event',    ['string'], [name]); },
        broadcastEvent: function(name: string): void { _ckSet('ck_broadcast_event', ['string'], [name]); },

        listenForEvent: function(name: string, callback: () => void): number {
            const id = _ckNextId++;
            _moduleConfig._ckEventListeners[id] = { callback: callback, once: false };
            _ckSet('ck_listen_event', ['string', 'number', 'number'], [name, id, 1]);
            return id;
        },
        listenForEventOnce: function(name: string, callback: () => void): number {
            const id = _ckNextId++;
            _moduleConfig._ckEventListeners[id] = { callback: callback, once: true };
            _ckSet('ck_listen_event', ['string', 'number', 'number'], [name, id, 0]);
            return id;
        },
        stopListeningForEvent: function(name: string, listenerId: number): void {
            delete _moduleConfig._ckEventListeners[listenerId];
            _ckSet('ck_stop_listening_event', ['string', 'number'], [name, listenerId]);
        },
        // Alias for WebChucK API compatibility
        startListeningForEvent: function(name: string, callback: () => void): number {
            return CK.listenForEvent(name, callback);
        },

        // ── Int array operations ───────────────────────────────────────

        setIntArray: function(name: string, jsArray: number[]): void {
            _ckDefer(function() {
                const buf = new Uint8Array(new Int32Array(jsArray).buffer);
                _module!.ccall('ck_set_int_array', 'number',
                    ['string', 'array', 'number'], [name, buf, jsArray.length]);
            });
        },
        setIntArrayValue:      function(name: string, index: number, value: number): void { _ckSet('ck_set_int_array_value',       ['string', 'number', 'number'], [name, index, value]); },
        setAssocIntArrayValue: function(name: string, key: string, value: number): void   { _ckSet('ck_set_assoc_int_array_value', ['string', 'string', 'number'], [name, key, value]); },
        getIntArray:           function(name: string): Promise<number[]>                   { return _ckGet('ck_get_int_array',             ['string'],                   [name]); },
        getIntArrayValue:      function(name: string, index: number): Promise<number>      { return _ckGet('ck_get_int_array_value',       ['string', 'number'],         [name, index]); },
        getAssocIntArrayValue: function(name: string, key: string): Promise<number>        { return _ckGet('ck_get_assoc_int_array_value', ['string', 'string'],         [name, key]); },

        // ── Float array operations ─────────────────────────────────────

        setFloatArray: function(name: string, jsArray: number[]): void {
            _ckDefer(function() {
                const buf = new Uint8Array(new Float64Array(jsArray).buffer);
                _module!.ccall('ck_set_float_array', 'number',
                    ['string', 'array', 'number'], [name, buf, jsArray.length]);
            });
        },
        setFloatArrayValue:      function(name: string, index: number, value: number): void { _ckSet('ck_set_float_array_value',       ['string', 'number', 'number'], [name, index, value]); },
        setAssocFloatArrayValue: function(name: string, key: string, value: number): void   { _ckSet('ck_set_assoc_float_array_value', ['string', 'string', 'number'], [name, key, value]); },
        getFloatArray:           function(name: string): Promise<number[]>                   { return _ckGet('ck_get_float_array',             ['string'],                   [name]); },
        getFloatArrayValue:      function(name: string, index: number): Promise<number>      { return _ckGet('ck_get_float_array_value',       ['string', 'number'],         [name, index]); },
        getAssocFloatArrayValue: function(name: string, key: string): Promise<number>        { return _ckGet('ck_get_assoc_float_array_value', ['string', 'string'],         [name, key]); },

        // ── Persistent Storage (IndexedDB) ─────────────────────────────

        save: function(key: string, value: unknown): Promise<void> {
            return _getDB().then(function(db: IDBDatabase) {
                return new Promise<void>(function(resolve, reject) {
                    const tx = db.transaction('kv', 'readwrite');
                    const req = tx.objectStore('kv').put(value, key);
                    req.onsuccess = function() { resolve(); };
                    req.onerror = function() { reject(req.error); };
                });
            });
        },

        load: function(key: string): Promise<unknown> {
            return _getDB().then(function(db: IDBDatabase) {
                return new Promise<unknown>(function(resolve, reject) {
                    const tx = db.transaction('kv', 'readonly');
                    const req = tx.objectStore('kv').get(key);
                    req.onsuccess = function() { resolve(req.result); };
                    req.onerror = function() { reject(req.error); };
                });
            });
        },

        delete: function(key: string): Promise<void> {
            return _getDB().then(function(db: IDBDatabase) {
                return new Promise<void>(function(resolve, reject) {
                    const tx = db.transaction('kv', 'readwrite');
                    const req = tx.objectStore('kv').delete(key);
                    req.onsuccess = function() { resolve(); };
                    req.onerror = function() { reject(req.error); };
                });
            });
        },

        listKeys: function(): Promise<string[]> {
            return _getDB().then(function(db: IDBDatabase) {
                return new Promise<string[]>(function(resolve, reject) {
                    const tx = db.transaction('kv', 'readonly');
                    const req = tx.objectStore('kv').getAllKeys();
                    req.onsuccess = function() { resolve(req.result as string[]); };
                    req.onerror = function() { reject(req.error); };
                });
            });
        },

        // ── MIDI ──────────────────────────────────────────────────────

        initMidi: function(access: MIDIAccess): void {
            const w = window as unknown as RtMidiWindow;
            w._rtmidi_internals_midi_access = access;
            w._rtmidi_internals_latest_message_timestamp = 0.0;
            w._rtmidi_internals_waiting = false;
            w._rtmidi_internals_get_port_by_number = function(portNumber: number, isInput: boolean): MIDIPort | null {
                const midi = w._rtmidi_internals_midi_access;
                const devices = isInput ? midi.inputs : midi.outputs;
                let i = 0;
                for (const device of devices.values()) {
                    if (i === portNumber) return device;
                    i++;
                }
                return null;
            };
        },

        // ── Dynamic Audio Import ───────────────────────────────────────

        loadAudio: function(url: string, vfsPath?: string): Promise<string> {
            let resolvedPath = vfsPath;
            if (!resolvedPath) {
                const parts = url.split('/');
                const name = parts[parts.length - 1].split('?')[0];
                resolvedPath = '/audio/' + (name || 'audio.wav');
            }
            if (resolvedPath[0] !== '/') resolvedPath = '/' + resolvedPath;
            const finalPath = resolvedPath;
            return fetch(url, { mode: 'cors' })
                .catch(function() {
                    throw new Error('Failed to fetch (CORS blocked or network error): ' + url);
                })
                .then(function(response: Response) {
                    if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + url);
                    return response.arrayBuffer();
                })
                .then(function(arrayBuffer: ArrayBuffer) {
                    const ctx: BaseAudioContext = _audioCtx || new OfflineAudioContext(1, 1, 48000);
                    return ctx.decodeAudioData(arrayBuffer);
                })
                .then(function(audioBuffer: AudioBuffer) {
                    const wavData = _audioBufferToWav(audioBuffer);
                    _ckDefer(function() {
                        _ensureVfsDir(finalPath);
                        _module!.FS.writeFile(finalPath, new Uint8Array(wavData));
                    });
                    console.log('[WebChuGL] Audio loaded: ' + finalPath +
                        ' (' + audioBuffer.duration.toFixed(2) + 's, ' +
                        audioBuffer.numberOfChannels + 'ch)');
                    return finalPath;
                });
        },

        // ── ChuGin Loading ────────────────────────────────────────────

        loadChugin: function(url: string): Promise<string> {
            const name = url.split('/').pop()!;
            const shortName = name.replace('.chug.wasm', '');
            if (_loadedChugins[shortName]) return Promise.resolve(shortName);
            return fetch(url).then(function(r: Response) {
                if (!r.ok) throw new Error('Failed to fetch chugin: ' + url);
                return r.arrayBuffer();
            }).then(function(buf: ArrayBuffer) {
                return _ckDeferPromise(function() {
                    const vfsPath = '/chugins/' + name;
                    _ensureVfsDir(vfsPath);
                    _module!.FS.writeFile(vfsPath, new Uint8Array(buf));
                    const loaded = _loadChuginFromVfs(vfsPath);
                    if (!loaded) return Promise.reject(new Error('Failed to load chugin: ' + name));
                    return Promise.resolve(loaded);
                });
            });
        },

        getLoadedChugins: function(): string[] {
            return Object.keys(_loadedChugins);
        },

        // ── WebChucK-compatible API ──────────────────────────────────

        // Shred management
        replaceCode: function(code: string): Promise<ReplaceResult> {
            return _ckDeferPromise(function() {
                const ok = _module!.ccall('ck_replace_code', 'number', ['string'], [code]);
                if (!ok) return Promise.reject(new Error('replaceCode failed'));
                const oldShred: number = _module!.ccall('ck_get_replace_old_shred', 'number', [], []);
                const newShred: number = _module!.ccall('ck_get_replace_new_shred', 'number', [], []);
                return Promise.resolve({ oldShred: oldShred, newShred: newShred });
            });
        },

        replaceFile: function(filename: string): Promise<ReplaceResult> {
            return _ckDeferPromise(function() {
                const ok = _module!.ccall('ck_replace_file', 'number', ['string'], [filename]);
                if (!ok) return Promise.reject(new Error('replaceFile failed'));
                const oldShred: number = _module!.ccall('ck_get_replace_old_shred', 'number', [], []);
                const newShred: number = _module!.ccall('ck_get_replace_new_shred', 'number', [], []);
                return Promise.resolve({ oldShred: oldShred, newShred: newShred });
            });
        },

        replaceFileWithArgs: function(filename: string, colonSeparatedArgs: string): Promise<ReplaceResult> {
            return _ckDeferPromise(function() {
                const ok = _module!.ccall('ck_replace_file_with_args', 'number',
                    ['string', 'string'], [filename, colonSeparatedArgs]);
                if (!ok) return Promise.reject(new Error('replaceFileWithArgs failed'));
                const oldShred: number = _module!.ccall('ck_get_replace_old_shred', 'number', [], []);
                const newShred: number = _module!.ccall('ck_get_replace_new_shred', 'number', [], []);
                return Promise.resolve({ oldShred: oldShred, newShred: newShred });
            });
        },

        removeLastCode: function(): Promise<number> {
            return _ckDeferPromise(function() {
                const shredID: number = _module!.ccall('ck_remove_last_code', 'number', [], []);
                if (!shredID) return Promise.reject(new Error('removeLastCode failed'));
                return Promise.resolve(shredID);
            });
        },

        removeShred: function(shredID: number): Promise<number> {
            return _ckDeferPromise(function() {
                const removed: number = _module!.ccall('ck_remove_shred', 'number', ['number'], [shredID]);
                if (!removed) return Promise.reject(new Error('removeShred failed'));
                return Promise.resolve(removed);
            });
        },

        isShredActive: function(shredID: number): Promise<number> {
            return _ckDeferPromise(function() {
                const active: number = _module!.ccall('ck_is_shred_active', 'number', ['number'], [shredID]);
                return Promise.resolve(active);
            });
        },

        runFileWithArgs: function(filename: string, colonSeparatedArgs: string): Promise<number> {
            return _ckDeferPromise(function() {
                return Promise.resolve(
                    _module!.ccall('ck_run_file_with_args', 'number',
                        ['string', 'string'], [filename, colonSeparatedArgs])
                );
            });
        },

        // VM time as Promise (WebChucK compat — getCurrentTime() is the sync version)
        now: function(): Promise<number> {
            return _ckDeferPromise(function() {
                return Promise.resolve(CK.getCurrentTime());
            });
        },

        // Print callback (WebChucK compat)
        // Usage: CK.chuckPrint = function(msg) { ... }
        set chuckPrint(callback: ((msg: string) => void) | null) {
            if (typeof callback === 'function') {
                _moduleConfig._onChuckPrint = callback;
                _ckDefer(function() {
                    _module!.ccall('ck_set_print_callback', null, ['number'], [1]);
                });
            } else {
                _moduleConfig._onChuckPrint = null;
                _ckDefer(function() {
                    _module!.ccall('ck_set_print_callback', null, ['number'], [0]);
                });
            }
        },
        get chuckPrint(): ((msg: string) => void) | null {
            return _moduleConfig._onChuckPrint || null;
        },

        // VM parameters
        setParamInt: function(name: string, val: number): void {
            _ckDefer(function() {
                _module!.ccall('ck_set_param_int', null, ['string', 'number'], [name, val]);
            });
        },
        getParamInt: function(name: string): number {
            if (!_module) return 0;
            return _module.ccall('ck_get_param_int', 'number', ['string'], [name]);
        },
        setParamFloat: function(name: string, val: number): void {
            _ckDefer(function() {
                _module!.ccall('ck_set_param_float', null, ['string', 'number'], [name, val]);
            });
        },
        getParamFloat: function(name: string): number {
            if (!_module) return 0;
            return _module.ccall('ck_get_param_float', 'number', ['string'], [name]);
        },
        setParamString: function(name: string, val: string): void {
            _ckDefer(function() {
                _module!.ccall('ck_set_param_string', null, ['string', 'string'], [name, val]);
            });
        },
        getParamString: function(name: string): string {
            if (!_module) return '';
            return _module.ccall('ck_get_param_string', 'string', ['string'], [name]);
        },

        // VM reset
        clearChuckInstance: function(): void {
            _ckDefer(function() {
                _module!.ccall('ck_clear_instance', null, [], []);
            });
        },
        clearGlobals: function(): void {
            _ckDefer(function() {
                _module!.ccall('ck_clear_globals', null, [], []);
            });
        },

        // ChuGin info (WebChucK compat alias)
        loadedChugins: function(): string[] {
            if (!_module) return [];
            const json: string = _module.ccall('ck_get_loaded_chugins', 'string', [], []);
            try { return JSON.parse(json); } catch(e) { return []; }
        },

        // Web Audio graph connection (WebChucK compat)
        connect: function(destination: AudioNode): void {
            if (_audioNode) _audioNode.connect(destination);
        },
        disconnect: function(): void {
            if (_audioNode) _audioNode.disconnect();
        },

        // ── ChuMP Package Loading ─────────────────────────────────────

        loadPackage: function(name: string, version?: string, url?: string): Promise<string> {
            if (!name || !/^[a-zA-Z0-9_@\/-]+$/.test(name)) {
                return Promise.reject(new Error('Invalid package name: ' + name));
            }
            const resolvedVersion = version || 'latest';
            if (!/^[a-zA-Z0-9._-]+$/.test(resolvedVersion)) {
                return Promise.reject(new Error('Invalid package version: ' + resolvedVersion));
            }

            const jszipReady = _ensureJSZip();

            // Resolve zip URL from ChuMP registry if not provided
            let zipPromise: Promise<ArrayBuffer>;
            if (url) {
                zipPromise = fetch(url).then(function(r: Response) {
                    if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + url);
                    return r.arrayBuffer();
                });
            } else {
                const manifestUrl = 'https://raw.githubusercontent.com/ccrma/chump-packages/main/packages/'
                    + name + '/' + resolvedVersion + '/' + name + '.json';
                zipPromise = fetch(manifestUrl).then(function(r: Response) {
                    if (!r.ok) throw new Error('Package not found: ' + name + '@' + resolvedVersion);
                    return r.json();
                }).then(function(manifest: any) {
                    const files: Array<{ url: string }> = manifest.files || [];
                    if (!files.length || !files[0].url) {
                        throw new Error('No download URL in manifest for ' + name);
                    }
                    return fetch(files[0].url).then(function(r: Response) {
                        if (!r.ok) throw new Error('HTTP ' + r.status);
                        return r.arrayBuffer();
                    });
                });
            }

            return Promise.all([jszipReady, zipPromise]).then(function(results: [void, ArrayBuffer]) {
                return JSZip.loadAsync(results[1]);
            }).then(function(zip: JSZipObject) {
                const stripDirs = ['examples', '_examples', 'scripts', 'releases', '.git'];
                const stripFiles = ['readme', 'versions', 'imgui.ini'];
                const entries = Object.keys(zip.files).filter(function(n: string) {
                    if (zip.files[n].dir) return false;
                    const firstDir = n.split('/')[0].toLowerCase();
                    if (stripDirs.indexOf(firstDir) >= 0) return false;
                    const basename = n.split('/').pop()!.toLowerCase();
                    if (stripFiles.indexOf(basename) >= 0) return false;
                    return true;
                });
                return Promise.all(entries.map(function(entryName: string) {
                    // Reject entries with path traversal components
                    const parts = entryName.split('/');
                    for (let pi = 0; pi < parts.length; pi++) {
                        if (parts[pi] === '..' || parts[pi] === '.') return Promise.resolve();
                    }
                    return zip.files[entryName].async('arraybuffer').then(function(content: ArrayBuffer) {
                        _ckDefer(function() {
                            const vfsPath = '/packages/' + name + '/' + entryName;
                            _ensureVfsDir(vfsPath);
                            _module!.FS.writeFile(vfsPath, new Uint8Array(content));
                        });
                    });
                }));
            }).then(function() {
                console.log('[WebChuGL] Package loaded: ' + name + '@' + resolvedVersion);
                return name;
            });
        }
    };

    // ── Launch ──────────────────────────────────────────────────────────
    return createWebChuGL(_moduleConfig as Partial<EmscriptenModule>).then(function(mod: EmscriptenModule) {
        _module = mod;

        if (!navigator.gpu) {
            _onError('WebGPU is not available');
            return CK;
        }

        // Fetch chugins in parallel with WebGPU adapter/device acquisition.
        // VFS writes are deferred until preRun has fired (module FS is ready).
        const _pendingChuginBuffers: Array<{ name: string; buf: ArrayBuffer }> = [];
        const chuginPromise: Promise<void[] | void> = _chuginUrls.length > 0
            ? Promise.all(_chuginUrls.map(function(url: string) {
                return fetch(url).then(function(r: Response) {
                    if (!r.ok) throw new Error('Failed to fetch chugin: ' + url);
                    return r.arrayBuffer();
                }).then(function(buf: ArrayBuffer) {
                    const chuginName = url.split('/').pop()!;
                    _pendingChuginBuffers.push({ name: chuginName, buf: buf });
                    console.log('[WebChuGL] Fetched chugin: ' + chuginName);
                });
            }))
            : Promise.resolve();

        const gpuPromise: Promise<GPUAdapter | null> = navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
            .then(function(adapter: GPUAdapter | null) {
                if (adapter) return adapter;
                console.warn('[WebChuGL] high-performance adapter unavailable, trying default');
                return navigator.gpu.requestAdapter();
            });

        return Promise.all([chuginPromise, gpuPromise]).then(function(results: [void[] | void, GPUAdapter | null]) {
            const adapter = results[1];
            if (!adapter) {
                _onError('Failed to get WebGPU adapter');
                return CK;
            }
            return adapter.requestDevice().then(function(device: GPUDevice) {
                _module!._preAdapter = adapter;
                _module!._preDevice = device;
                _onReady();
                _module!.callMain([]);

                // Write fetched chugins to VFS and load (after callMain so the_chuck exists)
                for (let i = 0; i < _pendingChuginBuffers.length; i++) {
                    const entry = _pendingChuginBuffers[i];
                    const vfsPath = '/chugins/' + entry.name;
                    _ensureVfsDir(vfsPath);
                    _module!.FS.writeFile(vfsPath, new Uint8Array(entry.buf));
                    const loaded = _loadChuginFromVfs(vfsPath);
                    if (!loaded) {
                        console.warn('[WebChuGL] Failed to load chugin: ' + vfsPath);
                    }
                }

                _initSensors(CK);
                _ckFlush();
                return CK;
            });
        }).catch(function(e: Error) {
            console.error('WebGPU pre-init failed:', e);
            _onError('WebGPU init failed: ' + e.message);
            _ckFlushCallbacks();
            return CK;
        });
    });
}
