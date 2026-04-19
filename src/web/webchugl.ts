// WebChuGL Runtime — ChucK class
// Bundled by esbuild into a single IIFE. Exposes _initWebChuGL global.

import type { ShredInfo, ReplaceResult, GlobalVariableInfo, WebChuGLInternalConfig, ChuginEntry } from './types/chuck.js';
import { ensureVfsDir, isBinaryFile } from './lib/vfs';
import { audioBufferToWav } from './lib/audio-utils';
import { initSensors } from './lib/sensors';
import { Storage } from './lib/storage';
import { registerServiceWorker } from './lib/service-worker';

// ============================================================================
// Non-standard API extensions (iOS Safari sensor permissions, MIDI internals)
// ============================================================================

interface RtMidiWindow extends Window {
    _rtmidi_internals_midi_access: MIDIAccess;
    _rtmidi_internals_latest_message_timestamp: number;
    _rtmidi_internals_waiting: boolean;
    _rtmidi_internals_get_port_by_number: (portNumber: number, isInput: boolean) => MIDIPort | null;
}

// ============================================================================
// RunResult — wraps code execution results with backward-compatible valueOf()
// ============================================================================

class RunResult {
    shredId: number;
    error: string | null;

    constructor(shredId: number, getError: () => string) {
        this.shredId = shredId;
        this.error = shredId === 0 ? getError() : null;
    }

    valueOf(): number {
        return this.shredId;
    }
}

// ============================================================================
// ChucK Class
// ============================================================================

class ChucK {
    // ── Private state ───────────────────────────────────────────────────
    private module: EmscriptenModule | null = null;
    private nextId = 1;
    private isReady = false;
    private deferQueue: Array<() => void> = [];
    private callbacks: Record<number, (value: any) => void> = {};
    private eventListeners: Record<number, CkEventListenerEntry> = {};
    private loadedChuginSet: Record<string, boolean> = {};
    private _audioCtx: AudioContext | null = null;
    private _audioNode: AudioWorkletNode | null = null;
    private _audioReady: Promise<void> | null = null;
    private _micConnected = false;
    private _sampleRate = 48000;
    private _printCallback: ((msg: string) => void) | null = null;
    private baseUrl: string;
    private jszipPromise: Promise<void> | null = null;
    private _storage = new Storage();
    private _removeAudioListeners: (() => void) | null = null;
    private _cleanupSensors: (() => void) | null = null;

    private constructor(baseUrl: string) {
        this.baseUrl = baseUrl;
    }

    // ── Defer queue (auto-queues calls until VM is ready) ───────────────

    private defer(fn: () => void): void {
        if (this.isReady) fn();
        else this.deferQueue.push(fn);
    }

    private deferPromise<T>(fn: () => Promise<T>): Promise<T> {
        if (this.isReady) {
            try { return fn(); }
            catch (e) { return Promise.reject(e); }
        }
        return new Promise<T>((resolve, reject) => {
            this.deferQueue.push(() => {
                try { fn().then(resolve, reject); }
                catch (e) { reject(e); }
            });
        });
    }

    private flush(): void {
        const queue = this.deferQueue;
        this.deferQueue = [];
        this.isReady = true;
        for (const fn of queue) fn();
    }

    private flushCallbacks(): void {
        for (const key of Object.keys(this.callbacks)) {
            const id = Number(key);
            this.callbacks[id](undefined);
            delete this.callbacks[id];
        }
    }

    // ── C++ bridge helpers ──────────────────────────────────────────────

    private ccallSet(func: string, types: string[], args: unknown[]): void {
        this.defer(() => {
            this.module!.ccall(func, 'number', types, args);
        });
    }

    private ccallGet(func: string, types: string[], args: unknown[]): Promise<any> {
        return this.deferPromise(() => {
            return new Promise((resolve, reject) => {
                const id = this.nextId++;
                this.callbacks[id] = resolve;
                const ret = this.module!.ccall(func, 'number', types.concat('number'), args.concat(id));
                if (!ret) {
                    delete this.callbacks[id];
                    reject(new Error(func + ' failed'));
                }
            });
        });
    }

    // ── JSZip lazy loading ──────────────────────────────────────────────

    private ensureJSZip(): Promise<void> {
        if (typeof JSZip !== 'undefined') return Promise.resolve();
        if (this.jszipPromise) return this.jszipPromise;
        this.jszipPromise = new Promise<void>((resolve, reject) => {
            const s = document.createElement('script');
            s.src = this.baseUrl + 'jszip.min.js';
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('Failed to load jszip'));
            document.head.appendChild(s);
        });
        return this.jszipPromise;
    }

    // ── ChuGin VFS loading ──────────────────────────────────────────────

    private loadChuginFromVfs(vfsPath: string): string | null {
        const filename = vfsPath.split('/').pop()!;
        const shortName = filename.replace('.chug.wasm', '');
        if (this.loadedChuginSet[shortName]) return shortName;
        const result = this.module!.ccall('ck_load_chugin', 'number', ['string'], [vfsPath]);
        if (result) {
            this.loadedChuginSet[shortName] = true;
            return shortName;
        }
        return null;
    }

    // ── Microphone connection (called from C++ when adc is used) ────────

    private connectMic(): void {
        if (this._micConnected || !this._audioCtx || !this._audioNode) return;
        this._micConnected = true;

        const ctx = this._audioCtx;
        const node = this._audioNode;
        navigator.mediaDevices.getUserMedia({ audio: true })
            .then((stream) => {
                ctx.createMediaStreamSource(stream).connect(node);
                console.log('[WebChuGL] Microphone connected');
            })
            .catch((err) => {
                console.log('[WebChuGL] Microphone not available: ' + err.message);
            });
    }

    // ── Audio init (called from C++ via Module._initAudio) ──────────────

    private handleInitAudio(
        sab: SharedArrayBuffer,
        outBufPtr: number, outWritePosPtr: number, outReadPosPtr: number,
        inBufPtr: number, inWritePosPtr: number, inReadPosPtr: number,
        capacity: number, needsMic: number,
        sampleRate: number, outChannels: number, inChannels: number,
    ): void {
        let ctx: AudioContext;
        try {
            ctx = new AudioContext({ sampleRate, latencyHint: 'interactive' });
        } catch (e) {
            console.error('[WebChuGL] Failed to create AudioContext: ' + (e as Error).message);
            return;
        }

        this._audioReady = ctx.audioWorklet.addModule(this.baseUrl + 'audio-worklet-processor.js').then(() => {
            const node = new AudioWorkletNode(ctx, 'chuck-processor', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [outChannels],
                channelCount: inChannels,
                channelCountMode: 'explicit',
            });

            node.port.postMessage({
                sab,
                outBufOffset: outBufPtr,
                outWritePosOffset: outWritePosPtr,
                outReadPosOffset: outReadPosPtr,
                inBufOffset: inBufPtr,
                inWritePosOffset: inWritePosPtr,
                inReadPosOffset: inReadPosPtr,
                capacity,
                outChannels,
                inChannels,
            });

            node.connect(ctx.destination);
            this._audioNode = node;

            if (needsMic) {
                this._micConnected = true;
                navigator.mediaDevices.getUserMedia({ audio: true })
                    .then((stream) => {
                        ctx.createMediaStreamSource(stream).connect(node);
                        console.log('[WebChuGL] Microphone connected');
                    })
                    .catch((err) => {
                        console.log('[WebChuGL] Microphone not available: ' + err.message);
                    });
            }

            // Resume AudioContext on user gesture. The AudioContext can fall
            // back into 'suspended' long after the first resume — for example
            // when the tab is backgrounded, the OS audio device changes, or
            // the user triggers a navigation interruption. We therefore
            // re-attach gesture listeners whenever statechange reports a
            // non-running state, and do not detach them on resume failure
            // (so the user can retry with another gesture).
            let attached = false;
            const gestureHandler = (): void => {
                if (!this._audioCtx || this._audioCtx.state === 'running') return;
                this._audioCtx.resume().catch((err) => {
                    console.warn('[WebChuGL] AudioContext resume failed:', err);
                });
            };
            const attachGestureListeners = (): void => {
                if (attached) return;
                document.addEventListener('click', gestureHandler);
                document.addEventListener('keydown', gestureHandler);
                document.addEventListener('touchstart', gestureHandler);
                attached = true;
            };
            const detachGestureListeners = (): void => {
                if (!attached) return;
                document.removeEventListener('click', gestureHandler);
                document.removeEventListener('keydown', gestureHandler);
                document.removeEventListener('touchstart', gestureHandler);
                attached = false;
            };
            const onStateChange = (): void => {
                if (!this._audioCtx) return;
                const state = this._audioCtx.state;
                if (state === 'running') {
                    detachGestureListeners();
                } else if (state === 'suspended') {
                    // Re-arm listeners so the next gesture can resume.
                    attachGestureListeners();
                }
                // 'closed' is terminal; teardown handler below clears the hook.
            };
            ctx.addEventListener('statechange', onStateChange);
            attachGestureListeners();
            this._removeAudioListeners = (): void => {
                detachGestureListeners();
                ctx.removeEventListener('statechange', onStateChange);
                this._removeAudioListeners = null;
            };

            console.log('[WebChuGL] Audio initialized (JS AudioWorklet)');
        }).catch((err) => {
            console.error('[WebChuGL] Audio worklet failed: ' + err.message);
        });
        // Store AudioContext immediately (synchronously) so getSampleRate() works
        // even before the worklet finishes loading. _audioNode is set in the .then().
        this._audioCtx = ctx;
    }

    // ════════════════════════════════════════════════════════════════════
    // Static Factory
    // ════════════════════════════════════════════════════════════════════

    static _create(config: WebChuGLInternalConfig): Promise<ChucK> {
        let baseUrl = config.baseUrl || 'webchugl/';
        if (baseUrl[baseUrl.length - 1] !== '/') baseUrl += '/';

        const instance = new ChucK(baseUrl);

        const onProgress = config.onProgress || (() => {});
        const onError = config.onError || ((msg: string) => console.error('[WebChuGL] ' + msg));
        const onReady = config.onReady || (() => {});

        // ── Service Worker ──────────────────────────────────────────
        if (config.serviceWorker !== false) {
            if (registerServiceWorker(config.serviceWorkerUrl || './sw.js')) {
                return new Promise<ChucK>(() => {}); // page reloading
            }
        }

        // ── Audio Config ────────────────────────────────────────────
        const audioConfig: WebChuGLAudioConfig = { sampleRate: 48000, outChannels: 2, inChannels: 2 };
        const params = new URLSearchParams(window.location.search);
        const sr = parseInt(params.get('srate') || '', 10);
        const out = parseInt(params.get('out') || '', 10);
        const inp = parseInt(params.get('in') || '', 10);
        if (sr > 0) audioConfig.sampleRate = sr;
        if (out > 0) audioConfig.outChannels = out;
        if (inp > 0) audioConfig.inChannels = inp;
        if (config.audioConfig) {
            if (config.audioConfig.sampleRate && config.audioConfig.sampleRate > 0)
                audioConfig.sampleRate = config.audioConfig.sampleRate;
            if (config.audioConfig.outputChannels && config.audioConfig.outputChannels > 0)
                audioConfig.outChannels = config.audioConfig.outputChannels;
            if (config.audioConfig.inputChannels && config.audioConfig.inputChannels > 0)
                audioConfig.inChannels = config.audioConfig.inputChannels;
        }
        instance._sampleRate = audioConfig.sampleRate;

        // ── Module Config ───────────────────────────────────────────
        const canvas = config.canvas;
        canvas.addEventListener('webglcontextlost', (e) => e.preventDefault(), false);

        const moduleConfig: Partial<EmscriptenModule> = {
            noInitialRun: true,
            _audioConfig: audioConfig,
            canvas: canvas,

            locateFile: (path: string) => {
                if (path === 'index.wasm') path = 'webchugl.wasm';
                return baseUrl + path;
            },

            print: (text: string) => {
                if (instance._printCallback) instance._printCallback(text);
                else console.log(text);
            },

            printErr: (text: string) => {
                if (instance._printCallback) instance._printCallback(text);
                else console.error(text);
            },
            setStatus: () => {},

            _ckCallbacks: instance.callbacks,
            _ckEventListeners: instance.eventListeners,

            _initAudio: (
                sab: SharedArrayBuffer,
                outBufPtr: number, outWritePosPtr: number, outReadPosPtr: number,
                inBufPtr: number, inWritePosPtr: number, inReadPosPtr: number,
                capacity: number, needsMic: number,
                sampleRate: number, outChannels: number, inChannels: number,
            ) => {
                instance.handleInitAudio(
                    sab, outBufPtr, outWritePosPtr, outReadPosPtr,
                    inBufPtr, inWritePosPtr, inReadPosPtr,
                    capacity, needsMic, sampleRate, outChannels, inChannels,
                );
            },

            _connectMic: () => { instance.connectMic(); },

            preRun: [(mod: EmscriptenModule) => {
                instance.module = mod;
                ensureVfsDir(mod.FS, '/code/');
                onProgress(100);
            }],
        };

        // ── Launch ──────────────────────────────────────────────────
        return createWebChuGL(moduleConfig).then((mod) => {
            instance.module = mod;

            if (!navigator.gpu) {
                onError('WebGPU is not available');
                return instance;
            }

            const pendingChuginBuffers: Array<{ name: string; buf: ArrayBuffer }> = [];
            const chuginEntries: ChuginEntry[] = config.chugins || [];

            // Partition into pre-fetched buffers and URLs to fetch
            const urlsToFetch: string[] = [];
            for (const entry of chuginEntries) {
                if (typeof entry === 'string') {
                    urlsToFetch.push(entry);
                } else {
                    pendingChuginBuffers.push(entry);
                }
            }

            const chuginPromise: Promise<void[] | void> = urlsToFetch.length > 0
                ? Promise.all(urlsToFetch.map((url) =>
                    fetch(url).then((r) => {
                        if (!r.ok) throw new Error('Failed to fetch chugin: ' + url);
                        return r.arrayBuffer();
                    }).then((buf) => {
                        const chuginName = url.split('/').pop()!;
                        pendingChuginBuffers.push({ name: chuginName, buf });
                        console.log('[WebChuGL] Fetched chugin: ' + chuginName);
                    })
                ))
                : Promise.resolve();

            const gpuPromise: Promise<GPUAdapter | null> = navigator.gpu
                .requestAdapter({ powerPreference: 'high-performance' })
                .then((adapter) => {
                    if (adapter) return adapter;
                    console.warn('[WebChuGL] high-performance adapter unavailable, trying default');
                    return navigator.gpu.requestAdapter();
                });

            return Promise.all([chuginPromise, gpuPromise]).then(([, adapter]) => {
                if (!adapter) {
                    onError('Failed to get WebGPU adapter');
                    return instance;
                }
                return adapter.requestDevice().then((device) => {
                    instance.module!._preAdapter = adapter;
                    instance.module!._preDevice = device;
                    onReady();
                    instance.module!.callMain([]);

                    // Make canvas track its parent container size instead of the window
                    instance.module!.ccall('chugl_setup_parent_resize', null, [], []);

                    for (const entry of pendingChuginBuffers) {
                        const vfsPath = '/chugins/' + entry.name;
                        ensureVfsDir(instance.module!.FS, vfsPath);
                        instance.module!.FS.writeFile(vfsPath, new Uint8Array(entry.buf));
                        if (!instance.loadChuginFromVfs(vfsPath)) {
                            console.warn('[WebChuGL] Failed to load chugin: ' + vfsPath);
                        }
                    }

                    instance._cleanupSensors = initSensors(instance, () => instance.module !== null);
                    const audioReady = instance._audioReady || Promise.resolve();
                    return audioReady.then(() => {
                        instance.flush();
                        return instance;
                    });
                });
            }).catch((e) => {
                console.error('WebGPU pre-init failed:', e);
                onError('WebGPU init failed: ' + e.message);
                instance.flushCallbacks();
                return instance;
            });
        });
    }

    // ════════════════════════════════════════════════════════════════════
    // Public API
    // ════════════════════════════════════════════════════════════════════

    // ── Audio access ────────────────────────────────────────────────────

    get audioContext(): AudioContext | null { return this._audioCtx; }
    get audioNode(): AudioWorkletNode | null { return this._audioNode; }

    getSampleRate(): number | null {
        return this._audioCtx ? this._audioCtx.sampleRate : null;
    }

    // ── VM Introspection ────────────────────────────────────────────────

    getCurrentTime(): number {
        if (!this.module) return 0;
        return this.module.ccall('ck_get_now', 'number', [], []);
    }

    fps(): number {
        if (!this.module) return 0;
        return this.module.ccall('ck_get_fps', 'number', [], []);
    }

    dt(): number {
        if (!this.module) return 0;
        return this.module.ccall('ck_get_dt', 'number', [], []);
    }

    frameCount(): number {
        if (!this.module) return 0;
        return this.module.ccall('ck_get_frame_count', 'number', [], []);
    }

    isRunning(): boolean {
        if (!this.module) return false;
        return !!this.module.ccall('ck_is_vm_running', 'number', [], []);
    }

    getActiveShreds(): ShredInfo[] {
        if (!this.module) return [];
        const json: string = this.module.ccall('ck_get_active_shreds', 'string', [], []);
        try { return JSON.parse(json); } catch { return []; }
    }

    getLastError(): string {
        if (!this.module) return '';
        return this.module.ccall('ck_get_last_compile_output', 'string', [], []);
    }

    getGlobalVariables(): GlobalVariableInfo[] {
        if (!this.module) return [];
        const json: string = this.module.ccall('ck_get_all_globals', 'string', [], []);
        try { return JSON.parse(json); } catch { return []; }
    }

    // ── Code Execution ──────────────────────────────────────────────────

    runCode(code: string): Promise<RunResult> {
        return this.deferPromise(() => {
            const shredId = this.module!.ccall('ck_run_code', 'number', ['string'], [code]);
            return Promise.resolve(new RunResult(shredId, () => this.getLastError()));
        });
    }

    runFile(pathOrUrl: string): Promise<RunResult> {
        if (pathOrUrl[0] === '/') {
            return this.deferPromise(() => {
                const shredId = this.module!.ccall('ck_run_file', 'number', ['string'], [pathOrUrl]);
                return Promise.resolve(new RunResult(shredId, () => this.getLastError()));
            });
        }
        const parts = pathOrUrl.split('/');
        const filename = parts[parts.length - 1];
        const vfsCheck = '/code/' + filename;
        try {
            this.module!.FS.stat(vfsCheck);
            return this.deferPromise(() => {
                const shredId = this.module!.ccall('ck_run_file', 'number', ['string'], [vfsCheck]);
                return Promise.resolve(new RunResult(shredId, () => this.getLastError()));
            });
        } catch {
            return this.loadFile(pathOrUrl).then((vfsPath) =>
                this.deferPromise(() => {
                    const shredId = this.module!.ccall('ck_run_file', 'number', ['string'], [vfsPath]);
                    return Promise.resolve(new RunResult(shredId, () => this.getLastError()));
                })
            );
        }
    }

    runZip(url: string, mainFile?: string): Promise<number> {
        let resolvedMainFile = mainFile;
        if (resolvedMainFile && resolvedMainFile[0] !== '/') resolvedMainFile = '/code/' + resolvedMainFile;
        const jszipReady = this.ensureJSZip();
        return fetch(url)
            .then((r) => {
                if (!r.ok) throw new Error('Failed to fetch ' + url);
                return r.arrayBuffer();
            })
            .then((zipData) => jszipReady.then(() => JSZip.loadAsync(zipData)))
            .then((zip) => {
                const entries = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
                if (!resolvedMainFile) {
                    if (entries.indexOf('main.ck') !== -1) {
                        resolvedMainFile = '/code/main.ck';
                    } else {
                        const rootCk = entries.filter((n) => n.endsWith('.ck') && n.indexOf('/') === -1);
                        resolvedMainFile = rootCk.length ? '/code/' + rootCk[0] : '/code/main.ck';
                    }
                }
                return Promise.all(entries.map((name) =>
                    zip.files[name].async('arraybuffer').then((content) => {
                        const vfsPath = '/code/' + name;
                        this.defer(() => {
                            ensureVfsDir(this.module!.FS, vfsPath);
                            this.module!.FS.writeFile(vfsPath, new Uint8Array(content));
                            if (name.endsWith('.chug.wasm')) this.loadChuginFromVfs(vfsPath);
                        });
                    })
                ));
            })
            .then(() => this.deferPromise(() =>
                Promise.resolve(this.module!.ccall('ck_run_file', 'number', ['string'], [resolvedMainFile!]))
            ));
    }

    // ── Virtual Filesystem ──────────────────────────────────────────────

    createFile(pathOrDir: string, filenameOrData: string | ArrayBuffer | Uint8Array, maybeData?: string | ArrayBuffer | Uint8Array): void {
        let path: string;
        let data: string | ArrayBuffer | Uint8Array;
        if (maybeData !== undefined) {
            // 3-arg: createFile(directory, filename, data)
            let dir = pathOrDir;
            if (dir && dir[dir.length - 1] !== '/') dir += '/';
            path = dir + (filenameOrData as string);
            data = maybeData;
        } else {
            // 2-arg: createFile(path, data)
            path = pathOrDir;
            data = filenameOrData;
        }
        this.defer(() => {
            ensureVfsDir(this.module!.FS, path);
            if (typeof data === 'string') {
                this.module!.FS.writeFile(path, data);
            } else {
                this.module!.FS.writeFile(path, new Uint8Array(data));
            }
        });
    }

    removeFile(path: string): boolean {
        try {
            const stat = this.module!.FS.stat(path);
            if (this.module!.FS.isDir(stat.mode)) {
                const entries = this.module!.FS.readdir(path).filter((e) => e !== '.' && e !== '..');
                for (const entry of entries) this.removeFile(path + '/' + entry);
                this.module!.FS.rmdir(path);
            } else {
                this.module!.FS.unlink(path);
            }
            return true;
        } catch { return false; }
    }

    fileExists(path: string): boolean {
        try { this.module!.FS.stat(path); return true; } catch { return false; }
    }

    listFiles(dir?: string): string[] {
        const baseDir = dir || '/code';
        const walk = (d: string): string[] => {
            const results: string[] = [];
            let entries: string[];
            try { entries = this.module!.FS.readdir(d); } catch { return results; }
            for (const entry of entries) {
                if (entry === '.' || entry === '..') continue;
                const full = d + '/' + entry;
                const stat = this.module!.FS.stat(full);
                if (this.module!.FS.isDir(stat.mode)) {
                    results.push(...walk(full));
                } else {
                    results.push(full);
                }
            }
            return results;
        };
        return walk(baseDir);
    }

    loadFile(url: string, vfsPath?: string): Promise<string> {
        let resolvedPath = vfsPath;
        if (!resolvedPath) {
            resolvedPath = '/code/' + url.split('/').pop()!;
        }
        if (resolvedPath[0] !== '/') resolvedPath = '/' + resolvedPath;
        const bin = isBinaryFile(resolvedPath);
        const isChugin = resolvedPath.endsWith('.chug.wasm');
        const finalPath = resolvedPath;
        return fetch(url)
            .then((r): Promise<string | ArrayBuffer> => {
                if (!r.ok) throw new Error('Failed to fetch ' + url);
                return bin ? r.arrayBuffer() : r.text();
            })
            .then((data) => {
                this.defer(() => {
                    ensureVfsDir(this.module!.FS, finalPath);
                    this.module!.FS.writeFile(finalPath, bin ? new Uint8Array(data as ArrayBuffer) : data as string);
                    if (isChugin) this.loadChuginFromVfs(finalPath);
                });
                return finalPath;
            });
    }

    loadFiles(basePath: string, files: string[]): Promise<string[]> {
        if (basePath[basePath.length - 1] !== '/') basePath += '/';
        return Promise.all(files.map((file) => {
            const url = basePath + file;
            const vfsPath = '/code/' + file;
            const bin = isBinaryFile(file);
            const isChugin = file.endsWith('.chug.wasm');
            return fetch(url)
                .then((r): Promise<string | ArrayBuffer> => {
                    if (!r.ok) throw new Error('Failed to fetch ' + url);
                    return bin ? r.arrayBuffer() : r.text();
                })
                .then((data) => {
                    this.defer(() => {
                        ensureVfsDir(this.module!.FS, vfsPath);
                        this.module!.FS.writeFile(vfsPath, bin ? new Uint8Array(data as ArrayBuffer) : data as string);
                        if (isChugin) this.loadChuginFromVfs(vfsPath);
                    });
                    return vfsPath;
                });
        }));
    }

    loadZip(url: string): Promise<void> {
        const jszipReady = this.ensureJSZip();
        return fetch(url)
            .then((r) => {
                if (!r.ok) throw new Error('Failed to fetch ' + url);
                return r.arrayBuffer();
            })
            .then((zipData) => jszipReady.then(() => JSZip.loadAsync(zipData)))
            .then((zip) => {
                const entries = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
                return Promise.all(entries.map((name) =>
                    zip.files[name].async('arraybuffer').then((content) => {
                        const vfsPath = '/code/' + name;
                        this.defer(() => {
                            ensureVfsDir(this.module!.FS, vfsPath);
                            this.module!.FS.writeFile(vfsPath, new Uint8Array(content));
                            if (name.endsWith('.chug.wasm')) this.loadChuginFromVfs(vfsPath);
                        });
                    })
                ));
            })
            .then(() => { console.log('[WebChuGL] Zip extracted: ' + url); });
    }

    // ── Scalar Variables ────────────────────────────────────────────────

    setInt(name: string, val: number): void { this.ccallSet('ck_set_int', ['string', 'number'], [name, val]); }
    setFloat(name: string, val: number): void { this.ccallSet('ck_set_float', ['string', 'number'], [name, val]); }
    setString(name: string, val: string): void { this.ccallSet('ck_set_string', ['string', 'string'], [name, val]); }
    getInt(name: string): Promise<number> { return this.ccallGet('ck_get_int', ['string'], [name]); }
    getFloat(name: string): Promise<number> { return this.ccallGet('ck_get_float', ['string'], [name]); }
    getString(name: string): Promise<string> { return this.ccallGet('ck_get_string', ['string'], [name]); }

    // ── Events ──────────────────────────────────────────────────────────

    signalEvent(name: string): void { this.ccallSet('ck_signal_event', ['string'], [name]); }
    broadcastEvent(name: string): void { this.ccallSet('ck_broadcast_event', ['string'], [name]); }

    startListeningForEvent(name: string, callback: () => void): number {
        const id = this.nextId++;
        this.eventListeners[id] = { callback, once: false };
        this.ccallSet('ck_listen_event', ['string', 'number', 'number'], [name, id, 1]);
        return id;
    }

    listenForEventOnce(name: string, callback: () => void): number {
        const id = this.nextId++;
        this.eventListeners[id] = { callback, once: true };
        this.ccallSet('ck_listen_event', ['string', 'number', 'number'], [name, id, 0]);
        return id;
    }

    stopListeningForEvent(name: string, listenerId: number): void {
        delete this.eventListeners[listenerId];
        this.ccallSet('ck_stop_listening_event', ['string', 'number'], [name, listenerId]);
    }

    // ── Int Array Variables ─────────────────────────────────────────────

    setIntArray(name: string, arr: number[]): void {
        this.defer(() => {
            const buf = new Uint8Array(new Int32Array(arr).buffer);
            this.module!.ccall('ck_set_int_array', 'number', ['string', 'array', 'number'], [name, buf, arr.length]);
        });
    }
    setIntArrayValue(name: string, index: number, value: number): void { this.ccallSet('ck_set_int_array_value', ['string', 'number', 'number'], [name, index, value]); }
    setAssocIntArrayValue(name: string, key: string, value: number): void { this.ccallSet('ck_set_assoc_int_array_value', ['string', 'string', 'number'], [name, key, value]); }
    getIntArray(name: string): Promise<number[]> { return this.ccallGet('ck_get_int_array', ['string'], [name]); }
    getIntArrayValue(name: string, index: number): Promise<number> { return this.ccallGet('ck_get_int_array_value', ['string', 'number'], [name, index]); }
    getAssocIntArrayValue(name: string, key: string): Promise<number> { return this.ccallGet('ck_get_assoc_int_array_value', ['string', 'string'], [name, key]); }

    // ── Float Array Variables ───────────────────────────────────────────

    setFloatArray(name: string, arr: number[]): void {
        this.defer(() => {
            const buf = new Uint8Array(new Float64Array(arr).buffer);
            this.module!.ccall('ck_set_float_array', 'number', ['string', 'array', 'number'], [name, buf, arr.length]);
        });
    }
    setFloatArrayValue(name: string, index: number, value: number): void { this.ccallSet('ck_set_float_array_value', ['string', 'number', 'number'], [name, index, value]); }
    setAssocFloatArrayValue(name: string, key: string, value: number): void { this.ccallSet('ck_set_assoc_float_array_value', ['string', 'string', 'number'], [name, key, value]); }
    getFloatArray(name: string): Promise<number[]> { return this.ccallGet('ck_get_float_array', ['string'], [name]); }
    getFloatArrayValue(name: string, index: number): Promise<number> { return this.ccallGet('ck_get_float_array_value', ['string', 'number'], [name, index]); }
    getAssocFloatArrayValue(name: string, key: string): Promise<number> { return this.ccallGet('ck_get_assoc_float_array_value', ['string', 'string'], [name, key]); }

    // ── Persistent Storage (IndexedDB) ──────────────────────────────────

    save(key: string, value: unknown): Promise<void> { return this._storage.save(key, value); }
    load(key: string): Promise<unknown> { return this._storage.load(key); }
    delete(key: string): Promise<void> { return this._storage.delete(key); }
    listKeys(): Promise<string[]> { return this._storage.listKeys(); }

    // ── MIDI ────────────────────────────────────────────────────────────

    initMidi(access: MIDIAccess): void {
        const w = window as unknown as RtMidiWindow;
        w._rtmidi_internals_midi_access = access;
        w._rtmidi_internals_latest_message_timestamp = 0.0;
        w._rtmidi_internals_waiting = false;
        w._rtmidi_internals_get_port_by_number = (portNumber, isInput) => {
            const devices = isInput ? access.inputs : access.outputs;
            let i = 0;
            for (const device of devices.values()) {
                if (i === portNumber) return device;
                i++;
            }
            return null;
        };
    }

    async requestMidi(): Promise<void> {
        if (!navigator.requestMIDIAccess) {
            throw new Error('Web MIDI API is not supported in this browser');
        }
        const access = await navigator.requestMIDIAccess();
        this.initMidi(access);
    }

    // ── Dynamic Audio Import ────────────────────────────────────────────

    loadAudio(url: string, vfsPath?: string): Promise<string> {
        let resolvedPath = vfsPath;
        if (!resolvedPath) {
            const name = url.split('/').pop()!.split('?')[0];
            resolvedPath = '/audio/' + (name || 'audio.wav');
        }
        if (resolvedPath[0] !== '/') resolvedPath = '/' + resolvedPath;
        const finalPath = resolvedPath;
        return fetch(url, { mode: 'cors' })
            .catch(() => { throw new Error('Failed to fetch (CORS blocked or network error): ' + url); })
            .then((r) => {
                if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + url);
                return r.arrayBuffer();
            })
            .then((arrayBuffer) => {
                const ctx: BaseAudioContext = this._audioCtx || new OfflineAudioContext(1, 1, this._sampleRate);
                return ctx.decodeAudioData(arrayBuffer);
            })
            .then((audioBuffer) => {
                const wavData = audioBufferToWav(audioBuffer);
                this.defer(() => {
                    ensureVfsDir(this.module!.FS, finalPath);
                    this.module!.FS.writeFile(finalPath, new Uint8Array(wavData));
                });
                console.log('[WebChuGL] Audio loaded: ' + finalPath +
                    ' (' + audioBuffer.duration.toFixed(2) + 's, ' +
                    audioBuffer.numberOfChannels + 'ch)');
                return finalPath;
            });
    }

    loadVideo(url: string, vfsPath?: string): Promise<string> {
        let resolvedPath = vfsPath;
        if (!resolvedPath) {
            const parts = url.split('/');
            resolvedPath = '/code/' + parts[parts.length - 1];
        }
        const finalPath = resolvedPath;
        return fetch(url)
            .then(res => {
                if (!res.ok) throw new Error('Failed to fetch video: ' + res.status);
                return res.arrayBuffer();
            })
            .then(buf => {
                this.defer(() => {
                    ensureVfsDir(this.module!.FS, finalPath);
                    this.module!.FS.writeFile(finalPath, new Uint8Array(buf));
                });
                console.log('[WebChuGL] Video loaded: ' + finalPath);
                return finalPath;
            });
    }

    // ── ChuGin Loading ──────────────────────────────────────────────────

    loadChugin(url: string): Promise<string> {
        const name = url.split('/').pop()!;
        const shortName = name.replace('.chug.wasm', '');
        if (this.loadedChuginSet[shortName]) return Promise.resolve(shortName);
        return fetch(url).then((r) => {
            if (!r.ok) throw new Error('Failed to fetch chugin: ' + url);
            return r.arrayBuffer();
        }).then((buf) => this.deferPromise(() => {
            const vfsPath = '/chugins/' + name;
            ensureVfsDir(this.module!.FS, vfsPath);
            this.module!.FS.writeFile(vfsPath, new Uint8Array(buf));
            const loaded = this.loadChuginFromVfs(vfsPath);
            if (!loaded) return Promise.reject(new Error('Failed to load chugin: ' + name));
            return Promise.resolve(loaded);
        }));
    }

    getLoadedChugins(): string[] {
        if (!this.module) return Object.keys(this.loadedChuginSet);
        try {
            const json: string = this.module.ccall('ck_get_loaded_chugins', 'string', [], []);
            return JSON.parse(json);
        } catch {
            return Object.keys(this.loadedChuginSet);
        }
    }

    // ── Shred Management ────────────────────────────────────────────────

    replaceCode(code: string): Promise<ReplaceResult> {
        return this.deferPromise(() => {
            const ok = this.module!.ccall('ck_replace_code', 'number', ['string'], [code]);
            if (!ok) return Promise.reject(new Error('replaceCode failed'));
            const oldShred: number = this.module!.ccall('ck_get_replace_old_shred', 'number', [], []);
            const newShred: number = this.module!.ccall('ck_get_replace_new_shred', 'number', [], []);
            return Promise.resolve({ oldShred, newShred });
        });
    }

    replaceFile(filename: string): Promise<ReplaceResult> {
        return this.deferPromise(() => {
            const ok = this.module!.ccall('ck_replace_file', 'number', ['string'], [filename]);
            if (!ok) return Promise.reject(new Error('replaceFile failed'));
            const oldShred: number = this.module!.ccall('ck_get_replace_old_shred', 'number', [], []);
            const newShred: number = this.module!.ccall('ck_get_replace_new_shred', 'number', [], []);
            return Promise.resolve({ oldShred, newShred });
        });
    }

    replaceFileWithArgs(filename: string, colonSeparatedArgs: string): Promise<ReplaceResult> {
        return this.deferPromise(() => {
            const ok = this.module!.ccall('ck_replace_file_with_args', 'number',
                ['string', 'string'], [filename, colonSeparatedArgs]);
            if (!ok) return Promise.reject(new Error('replaceFileWithArgs failed'));
            const oldShred: number = this.module!.ccall('ck_get_replace_old_shred', 'number', [], []);
            const newShred: number = this.module!.ccall('ck_get_replace_new_shred', 'number', [], []);
            return Promise.resolve({ oldShred, newShred });
        });
    }

    removeLastCode(): Promise<number> {
        return this.deferPromise(() => {
            const shredID: number = this.module!.ccall('ck_remove_last_code', 'number', [], []);
            if (!shredID) return Promise.reject(new Error('removeLastCode failed'));
            return Promise.resolve(shredID);
        });
    }

    removeShred(shredID: number): Promise<number> {
        return this.deferPromise(() => {
            const removed: number = this.module!.ccall('ck_remove_shred', 'number', ['number'], [shredID]);
            if (!removed) return Promise.reject(new Error('removeShred failed'));
            return Promise.resolve(removed);
        });
    }

    isShredActive(shredID: number): Promise<number> {
        return this.deferPromise(() =>
            Promise.resolve(this.module!.ccall('ck_is_shred_active', 'number', ['number'], [shredID]))
        );
    }

    runFileWithArgs(filename: string, colonSeparatedArgs: string): Promise<RunResult> {
        return this.deferPromise(() => {
            const shredId = this.module!.ccall('ck_run_file_with_args', 'number',
                ['string', 'string'], [filename, colonSeparatedArgs]);
            return Promise.resolve(new RunResult(shredId, () => this.getLastError()));
        });
    }

    now(): Promise<number> {
        return this.deferPromise(() => Promise.resolve(this.getCurrentTime()));
    }

    // ── Print Callback ──────────────────────────────────────────────────

    get chuckPrint(): ((msg: string) => void) | null {
        return this._printCallback;
    }

    set chuckPrint(callback: ((msg: string) => void) | null) {
        if (typeof callback === 'function') {
            this._printCallback = callback;
            this.defer(() => {
                this.module!.ccall('ck_set_print_callback', null, ['number'], [1]);
            });
        } else {
            this._printCallback = null;
            this.defer(() => {
                this.module!.ccall('ck_set_print_callback', null, ['number'], [0]);
            });
        }
    }

    // ── VM Engine Parameters ────────────────────────────────────────────

    setParamInt(name: string, val: number): void {
        this.defer(() => this.module!.ccall('ck_set_param_int', null, ['string', 'number'], [name, val]));
    }
    getParamInt(name: string): number {
        if (!this.module) return 0;
        return this.module.ccall('ck_get_param_int', 'number', ['string'], [name]);
    }
    setParamFloat(name: string, val: number): void {
        this.defer(() => this.module!.ccall('ck_set_param_float', null, ['string', 'number'], [name, val]));
    }
    getParamFloat(name: string): number {
        if (!this.module) return 0;
        return this.module.ccall('ck_get_param_float', 'number', ['string'], [name]);
    }
    setParamString(name: string, val: string): void {
        this.defer(() => this.module!.ccall('ck_set_param_string', null, ['string', 'string'], [name, val]));
    }
    getParamString(name: string): string {
        if (!this.module) return '';
        return this.module.ccall('ck_get_param_string', 'string', ['string'], [name]);
    }

    // ── VM Reset ────────────────────────────────────────────────────────

    clearChuckInstance(): void {
        this.defer(() => this.module!.ccall('ck_clear_instance', null, [], []));
    }
    clearGlobals(): void {
        this.defer(() => this.module!.ccall('ck_clear_globals', null, [], []));
    }
    reset(): void {
        this.clearChuckInstance();
        this.clearGlobals();
        this.defer(() => this.module!.ccall('ck_reset_graphics', null, [], []));
    }

    destroy(): void {
        if (!this.module) return;

        // Stop the C++ render loop so it doesn't try to render after teardown
        this.module.ccall('ck_stop_render_loop', null, [], []);

        // Clear ChucK VM state
        this.module.ccall('ck_clear_instance', null, [], []);
        this.module.ccall('ck_clear_globals', null, [], []);

        // Clean up audio
        if (this._removeAudioListeners) this._removeAudioListeners();
        if (this._audioNode) { this._audioNode.disconnect(); this._audioNode = null; }
        if (this._audioCtx) { this._audioCtx.close(); this._audioCtx = null; }
        this._audioReady = null;

        // Clean up canvas (observer, wrapper)
        const canvas = this.module.canvas as HTMLCanvasElement;
        if (canvas) {
            if ((canvas as any)._chuglParentObserver) {
                (canvas as any)._chuglParentObserver.disconnect();
                delete (canvas as any)._chuglParentObserver;
            }
            if ((canvas as any)._chuglWrapper) {
                const wrapper = (canvas as any)._chuglWrapper;
                if (wrapper.parentElement) {
                    wrapper.parentElement.insertBefore(canvas, wrapper);
                    wrapper.parentElement.removeChild(wrapper);
                }
                delete (canvas as any)._chuglWrapper;
            }
            // Unconfigure WebGPU context so the next init gets a clean surface
            const gpuCtx = canvas.getContext('webgpu');
            if (gpuCtx) gpuCtx.unconfigure();
        }

        // Clean up sensors
        if (this._cleanupSensors) { this._cleanupSensors(); this._cleanupSensors = null; }

        // Flush pending callbacks
        this.flushCallbacks();

        // Null out module and reset state
        this.module = null;
        this.isReady = false;
        this.deferQueue = [];
        this.callbacks = {};
        this.eventListeners = {};
        this.loadedChuginSet = {};
        this._micConnected = false;
        this._printCallback = null;

        console.log('[WebChuGL] Instance destroyed');
    }

    // ── Web Audio Graph ─────────────────────────────────────────────────

    connect(destination: AudioNode): void {
        if (this._audioNode) this._audioNode.connect(destination);
    }
    disconnect(): void {
        if (this._audioNode) this._audioNode.disconnect();
    }

    // ── ChuMP Package Loading ───────────────────────────────────────────

    private static readonly CHUMP_RAW = 'https://raw.githubusercontent.com/ccrma/chump-packages/main/packages';
    private static readonly CHUMP_API = 'https://api.github.com/repos/ccrma/chump-packages/contents/packages';
    private static readonly CORS_PROXY = 'https://cors.webchugl.workers.dev/?url=';

    /**
     * Resolve the latest version of a package by listing version directories
     * from the GitHub API and picking the highest semver.
     */
    private resolveLatestVersion(name: string): Promise<string> {
        return fetch(ChucK.CHUMP_API + '/' + name).then((r) => {
            if (!r.ok) throw new Error('Package not found: ' + name);
            return r.json();
        }).then((entries: Array<{ name: string; type: string }>) => {
            const versions = entries
                .filter((e) => e.type === 'dir' && /^\d/.test(e.name))
                .map((e) => e.name);
            if (!versions.length) throw new Error('No versions found for package: ' + name);
            versions.sort((a, b) => {
                const pa = a.split('.').map(Number);
                const pb = b.split('.').map(Number);
                for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
                    const diff = (pa[i] || 0) - (pb[i] || 0);
                    if (diff !== 0) return diff;
                }
                return 0;
            });
            return versions[versions.length - 1];
        });
    }

    /**
     * Fetch a URL, falling back to a CORS proxy if the direct request fails.
     */
    private fetchWithCorsProxy(url: string): Promise<Response> {
        return fetch(url).then((r) => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r;
        }).catch(() => {
            return fetch(ChucK.CORS_PROXY + encodeURIComponent(url)).then((r) => {
                if (!r.ok) throw new Error('HTTP ' + r.status + ' (via CORS proxy)');
                return r;
            });
        });
    }

    loadPackage(name: string, version?: string, url?: string): Promise<string> {
        if (!name || !/^[a-zA-Z0-9_@\/-]+$/.test(name)) {
            return Promise.reject(new Error('Invalid package name: ' + name));
        }
        if (version && !/^[a-zA-Z0-9._-]+$/.test(version)) {
            return Promise.reject(new Error('Invalid package version: ' + version));
        }

        const jszipReady = this.ensureJSZip();

        // Resolve version: if not provided, find the latest from the registry
        const versionPromise: Promise<string> = version
            ? Promise.resolve(version)
            : this.resolveLatestVersion(name);

        let resolvedVersionStr = version || '';
        const zipPromise: Promise<ArrayBuffer> = versionPromise.then((resolvedVersion) => {
            resolvedVersionStr = resolvedVersion;

            if (url) {
                return this.fetchWithCorsProxy(url).then((r) => r.arrayBuffer());
            }

            const manifestUrl = ChucK.CHUMP_RAW + '/' + name + '/' + resolvedVersion + '/' + name + '.json';
            return fetch(manifestUrl).then((r) => {
                if (!r.ok) throw new Error('Package not found: ' + name + '@' + resolvedVersion);
                return r.json();
            }).then((manifest: any) => {
                const files: Array<{ url: string }> = manifest.files || [];
                if (!files.length || !files[0].url) {
                    throw new Error('No download URL in manifest for ' + name);
                }
                return this.fetchWithCorsProxy(files[0].url).then((r) => r.arrayBuffer());
            });
        });

        return Promise.all([jszipReady, zipPromise]).then(([, zipData]) =>
            JSZip.loadAsync(zipData)
        ).then((zip) => {
            const stripDirs = ['examples', '_examples', 'scripts', 'releases', '.git'];
            const stripFiles = ['readme', 'versions', 'imgui.ini'];
            const entries = Object.keys(zip.files).filter((n) => {
                if (zip.files[n].dir) return false;
                const firstDir = n.split('/')[0].toLowerCase();
                if (stripDirs.indexOf(firstDir) >= 0) return false;
                const basename = n.split('/').pop()!.toLowerCase();
                if (stripFiles.indexOf(basename) >= 0) return false;
                return true;
            });
            return Promise.all(entries.map((entryName) => {
                const parts = entryName.split('/');
                for (const part of parts) {
                    if (part === '..' || part === '.') return Promise.resolve();
                }
                return zip.files[entryName].async('arraybuffer').then((content) => {
                    this.defer(() => {
                        const vfsPath = '/packages/' + name + '/' + entryName;
                        ensureVfsDir(this.module!.FS, vfsPath);
                        this.module!.FS.writeFile(vfsPath, new Uint8Array(content));
                    });
                });
            }));
        }).then(() => {
            console.log('[WebChuGL] Package loaded: ' + name + '@' + resolvedVersionStr);
            return name;
        });
    }
}

// ============================================================================
// Expose to global scope (called by webchugl-esm.ts via <script> tag)
// ============================================================================
(globalThis as any)._initWebChuGL = ChucK._create;
