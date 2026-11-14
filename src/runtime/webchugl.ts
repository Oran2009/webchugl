// Bundled by esbuild into an ES module; webchugl-esm.ts imports initWebChuGL.

import type { ShredInfo, ReplaceResult, GlobalVariableInfo, WebChuGLInternalConfig, ChuginEntry } from './types/chuck.js';
import { ensureVfsDir, isBinaryFile } from './lib/vfs';
import { audioBufferToWav } from './lib/audio-utils';
import { initSensors } from './lib/sensors';
import { Storage } from './lib/storage';
import { registerServiceWorker } from './lib/service-worker';

// Non-standard: iOS Safari sensor permissions, MIDI internals.

interface RtMidiWindow extends Window {
    _rtmidi_internals_midi_access: MIDIAccess;
    _rtmidi_internals_latest_message_timestamp: number;
    _rtmidi_internals_waiting: boolean;
    _rtmidi_internals_get_port_by_number: (portNumber: number, isInput: boolean) => MIDIPort | null;
}

// Shape of chuck.stanford.edu/release/chump/manifest/

interface ChumpFileEntry {
    url: string;
    checksum: string;
    file_type: string;
    local_dir: string;
}

interface ChumpVersionEntry {
    version: string;
    os: string;
    arch: string;
    files: ChumpFileEntry[];
}

interface ChumpPackage {
    name: string;
    description: string;
    authors: string[];
    versions: ChumpVersionEntry[];
}

interface ChumpManifest {
    packages: ChumpPackage[];
}

// valueOf() keeps callers that treat a run result as a bare shred id working.
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

class ChucK {
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
    private _micStream: MediaStream | null = null;
    private _micSource: MediaStreamAudioSourceNode | null = null;
    private _sampleRate = 48000;
    private _printCallback: ((msg: string) => void) | null = null;
    private baseUrl: string;
    private jszipPromise: Promise<void> | null = null;
    private _storage = new Storage();
    private _teardown = new AbortController();
    private _initError: Error | null = null;

    private constructor(baseUrl: string) {
        this.baseUrl = baseUrl;
    }

    // Calls made before the VM is ready are queued here.

    private defer(fn: () => void): void {
        if (this._initError) throw this._initError;
        if (this.isReady) fn();
        else this.deferQueue.push(fn);
    }

    private deferPromise<T>(fn: () => T | Promise<T>): Promise<T> {
        if (this._initError) return Promise.reject(this._initError);
        if (this.isReady) {
            try { return Promise.resolve(fn()); }
            catch (e) { return Promise.reject(e); }
        }
        return new Promise<T>((resolve, reject) => {
            this.deferQueue.push(() => {
                try { Promise.resolve(fn()).then(resolve, reject); }
                catch (e) { reject(e); }
            });
        });
    }

    private writeVfs(path: string, data: string | ArrayBuffer | Uint8Array): void {
        ensureVfsDir(this.module!.FS, path);
        this.module!.FS.writeFile(path,
            typeof data === 'string' ? data : new Uint8Array(data as ArrayBuffer));
    }

    // Returns the zip's entry names, each written to / and chugins loaded.
    private unzipToVfs(url: string): Promise<string[]> {
        const jszipReady = this.ensureJSZip();
        return ChucK.fetchBuf(url)
            .then((zipData) => jszipReady.then(() => JSZip.loadAsync(zipData)))
            .then((zip) => {
                const entries = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
                return Promise.all(entries.map((name) =>
                    zip.files[name].async('arraybuffer').then((content) => {
                        this.defer(() => {
                            this.writeVfs('/' + name, content);
                            if (name.endsWith('.chug.wasm')) this.loadChuginFromVfs('/' + name);
                        });
                    })
                )).then(() => entries);
            });
    }

    private runVfsFile(path: string): Promise<RunResult> {
        return this.deferPromise(() => {
            const shredId = this.module!.ccall('ck_run_file', 'number', ['string'], [path]);
            return new RunResult(shredId, () => this.getLastError());
        });
    }

    private replaceVia(func: string, types: string[], args: unknown[]): Promise<ReplaceResult> {
        return this.deferPromise(() => {
            if (!this.module!.ccall(func, 'number', types, args)) {
                return Promise.reject(new Error(func + ' failed'));
            }
            return {
                oldShred: this.module!.ccall('ck_get_replace_old_shred', 'number', [], []),
                newShred: this.module!.ccall('ck_get_replace_new_shred', 'number', [], []),
            };
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

    // Called from C++ via Module._initAudio.

    private handleInitAudio(
        sab: SharedArrayBuffer,
        outBufPtr: number, outWritePosPtr: number, outReadPosPtr: number,
        inBufPtr: number, inWritePosPtr: number, inReadPosPtr: number,
        capacity: number,
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

            // An AudioContext can re-suspend long after the first resume (backgrounded
            // tab, device change), so listeners re-arm on any non-running state.
            let attached = false;
            const gestureHandler = (): void => {
                if (!this._audioCtx || this._audioCtx.state === 'running') return;
                this._audioCtx.resume().catch((err) => {
                    console.warn('[WebChuGL] AudioContext resume failed:', err);
                });
            };
            const signal = this._teardown.signal;
            const attachGestureListeners = (): void => {
                if (attached) return;
                document.addEventListener('click', gestureHandler, { signal });
                document.addEventListener('keydown', gestureHandler, { signal });
                document.addEventListener('touchstart', gestureHandler, { signal });
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
                    attachGestureListeners();
                }
            };
            ctx.addEventListener('statechange', onStateChange, { signal });
            attachGestureListeners();

            console.log('[WebChuGL] Audio initialized (JS AudioWorklet)');
        }).catch((err) => {
            console.error('[WebChuGL] Audio worklet failed: ' + err.message);
        });
        // Set synchronously so getSampleRate() works before the worklet loads.
        this._audioCtx = ctx;
    }

    static _create(config: WebChuGLInternalConfig): Promise<ChucK> {
        let baseUrl = config.baseUrl || 'webchugl/';
        if (baseUrl[baseUrl.length - 1] !== '/') baseUrl += '/';

        const instance = new ChucK(baseUrl);

        const onProgress = config.onProgress || (() => {});
        const onError = config.onError || ((msg: string) => console.error('[WebChuGL] ' + msg));
        const onReady = config.onReady || (() => {});

        if (config.serviceWorker !== false) {
            if (registerServiceWorker('./sw.js')) {
                return new Promise<ChucK>(() => {}); // page reloading
            }
        }

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

        const canvas = config.canvas;
        canvas.addEventListener('webglcontextlost', (e) => e.preventDefault(), false);

        // Init resolves even on failure (callers get onError), so mark the
        // instance dead: later calls throw instead of queueing forever.
        const fail = (msg: string): ChucK => {
            instance._initError = new Error('[WebChuGL] ' + msg);
            onError(msg);
            instance.flushCallbacks();
            return instance;
        };

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
                capacity: number,
                sampleRate: number, outChannels: number, inChannels: number,
            ) => {
                instance.handleInitAudio(
                    sab, outBufPtr, outWritePosPtr, outReadPosPtr,
                    inBufPtr, inWritePosPtr, inReadPosPtr,
                    capacity, sampleRate, outChannels, inChannels,
                );
            },

            preRun: [(mod: EmscriptenModule) => {
                instance.module = mod;
                onProgress(100);
            }],
        };

        // Imported at runtime, not statically: the glue sits next to the wasm at
        // baseUrl, which is only known once init() is called.
        return import(/* @vite-ignore */ baseUrl + 'index.js')
            .then((glue: { default: CreateWebChuGL }) => glue.default(moduleConfig))
            .then((mod) => {
            instance.module = mod;

            if (!navigator.gpu) {
                return fail('WebGPU is not available');
            }

            const pendingChuginBuffers: Array<{ name: string; buf: ArrayBuffer }> = [];
            const chuginEntries: ChuginEntry[] = config.chugins || [];

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
                    ChucK.fetchBuf(url).then((buf) => {
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
                    return fail('Failed to get WebGPU adapter');
                }
                const limits: Record<string, number> = {};
                for (const k in adapter.limits) {
                    const v = (adapter.limits as any)[k];
                    if (typeof v === 'number') limits[k] = v;
                }
                return adapter.requestDevice({
                    requiredFeatures: adapter.features.has('float32-filterable')
                        ? ['float32-filterable' as GPUFeatureName] : [],
                    requiredLimits: limits,
                }).then((device) => {
                    instance.module!._preAdapter = adapter;
                    instance.module!._preDevice = device;
                    onReady();
                    instance.module!.callMain([]);

                    instance.module!.ccall('chugl_setup_parent_resize', null, [], []);

                    for (const entry of pendingChuginBuffers) {
                        const vfsPath = '/chugins/' + entry.name;
                        instance.writeVfs(vfsPath, entry.buf);
                        if (!instance.loadChuginFromVfs(vfsPath)) {
                            console.warn('[WebChuGL] Failed to load chugin: ' + vfsPath);
                        }
                    }

                    initSensors(instance, instance._teardown.signal);

                    window.addEventListener('pagehide', () => instance.destroy(),
                                            { signal: instance._teardown.signal });
                    const audioReady = instance._audioReady || Promise.resolve();
                    return audioReady.then(() => {
                        instance.flush();
                        return instance;
                    });
                });
            }).catch((e) => {
                console.error('WebGPU pre-init failed:', e);
                return fail('WebGPU init failed: ' + e.message);
            });
        });
    }


    get audioContext(): AudioContext | null { return this._audioCtx; }
    get audioNode(): AudioWorkletNode | null { return this._audioNode; }

    getSampleRate(): number | null {
        return this._audioCtx ? this._audioCtx.sampleRate : null;
    }


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


    runCode(code: string): Promise<RunResult> {
        return this.deferPromise(() => {
            const shredId = this.module!.ccall('ck_run_code', 'number', ['string'], [code]);
            return new RunResult(shredId, () => this.getLastError());
        });
    }

    runFile(pathOrUrl: string): Promise<RunResult> {
        if (pathOrUrl[0] === '/') return this.runVfsFile(pathOrUrl);
        const vfsCheck = '/' + pathOrUrl.split('/').pop()!;
        try {
            this.module!.FS.stat(vfsCheck);
            return this.runVfsFile(vfsCheck);
        } catch {
            return this.loadFile(pathOrUrl).then((vfsPath) => this.runVfsFile(vfsPath));
        }
    }

    runZip(url: string, mainFile?: string): Promise<number> {
        let main = mainFile;
        if (main && main[0] !== '/') main = '/' + main;
        return this.unzipToVfs(url).then((entries) => {
            if (!main) {
                const rootCk = entries.filter((n) => n.endsWith('.ck') && n.indexOf('/') === -1);
                main = entries.indexOf('main.ck') !== -1 ? '/main.ck'
                     : rootCk.length ? '/' + rootCk[0] : '/main.ck';
            }
            return this.deferPromise(() =>
                this.module!.ccall('ck_run_file', 'number', ['string'], [main!]) as number
            );
        });
    }


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
        this.defer(() => this.writeVfs(path, data));
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
            resolvedPath = '/' + url.split('/').pop()!;
        }
        if (resolvedPath[0] !== '/') resolvedPath = '/' + resolvedPath;
        const bin = isBinaryFile(resolvedPath);
        const isChugin = resolvedPath.endsWith('.chug.wasm');
        const finalPath = resolvedPath;
        return ChucK.fetchOk(url)
            .then((r): Promise<string | ArrayBuffer> => bin ? r.arrayBuffer() : r.text())
            .then((data) => {
                this.defer(() => {
                    this.writeVfs(finalPath, data);
                    if (isChugin) this.loadChuginFromVfs(finalPath);
                });
                return finalPath;
            });
    }

    loadFiles(basePath: string, files: string[]): Promise<string[]> {
        if (basePath[basePath.length - 1] !== '/') basePath += '/';
        return Promise.all(files.map((file) => {
            const url = basePath + file;
            const vfsPath = '/' + file;
            const bin = isBinaryFile(file);
            const isChugin = file.endsWith('.chug.wasm');
            return ChucK.fetchOk(url)
                .then((r): Promise<string | ArrayBuffer> => bin ? r.arrayBuffer() : r.text())
                .then((data) => {
                    this.defer(() => {
                        this.writeVfs(vfsPath, data);
                        if (isChugin) this.loadChuginFromVfs(vfsPath);
                    });
                    return vfsPath;
                });
        }));
    }

    loadZip(url: string): Promise<void> {
        return this.unzipToVfs(url)
            .then(() => { console.log('[WebChuGL] Zip extracted: ' + url); });
    }


    setInt(name: string, val: number): void { this.ccallSet('ck_set_int', ['string', 'number'], [name, val]); }
    setFloat(name: string, val: number): void { this.ccallSet('ck_set_float', ['string', 'number'], [name, val]); }
    setString(name: string, val: string): void { this.ccallSet('ck_set_string', ['string', 'string'], [name, val]); }
    getInt(name: string): Promise<number> { return this.ccallGet('ck_get_int', ['string'], [name]); }
    getFloat(name: string): Promise<number> { return this.ccallGet('ck_get_float', ['string'], [name]); }
    getString(name: string): Promise<string> { return this.ccallGet('ck_get_string', ['string'], [name]); }


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


    save(key: string, value: unknown): Promise<void> { return this._storage.save(key, value); }
    load(key: string): Promise<unknown> { return this._storage.load(key); }
    delete(key: string): Promise<void> { return this._storage.delete(key); }
    listKeys(): Promise<string[]> { return this._storage.listKeys(); }


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

    async requestMicrophone(): Promise<void> {
        if (this._micStream) return;  // idempotent
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('getUserMedia not supported in this browser');
        }
        // Audio init finishes after init() resolves; wait so chained calls don't race.
        if (this._audioReady) await this._audioReady;
        if (!this._audioCtx || !this._audioNode) {
            throw new Error('AudioContext not ready; ChuGL audio init did not complete');
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = this._audioCtx.createMediaStreamSource(stream);
        source.connect(this._audioNode);
        this._micStream = stream;
        this._micSource = source;
        console.log('[WebChuGL] Microphone connected');
    }

    requestWebcam(deviceId: number = 0): Promise<void> {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            return Promise.reject(new Error('getUserMedia not supported in this browser'));
        }
        const mod = this.module as any;
        mod.__webcamStreams = mod.__webcamStreams || {};
        if (mod.__webcamStreams[deviceId]) return Promise.resolve();

        return navigator.mediaDevices.getUserMedia({ video: true }).then((stream) => {
            mod.__webcamStreams[deviceId] = stream;
        });
    }


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
            .then((r) => r.arrayBuffer())
            .then((arrayBuffer) => {
                const ctx: BaseAudioContext = this._audioCtx || new OfflineAudioContext(1, 1, this._sampleRate);
                return ctx.decodeAudioData(arrayBuffer);
            })
            .then((audioBuffer) => {
                const wavData = audioBufferToWav(audioBuffer);
                this.defer(() => this.writeVfs(finalPath, wavData));
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
            resolvedPath = '/' + parts[parts.length - 1];
        }
        const finalPath = resolvedPath;
        return fetch(url)
            .then(res => {
                if (!res.ok) throw new Error('Failed to fetch video: ' + res.status);
                return res.arrayBuffer();
            })
            .then(buf => {
                this.defer(() => this.writeVfs(finalPath, buf));
                console.log('[WebChuGL] Video loaded: ' + finalPath);
                return finalPath;
            });
    }


    loadChugin(url: string): Promise<string> {
        const name = url.split('/').pop()!;
        const shortName = name.replace('.chug.wasm', '');
        if (this.loadedChuginSet[shortName]) return Promise.resolve(shortName);
        return ChucK.fetchBuf(url).then((buf) => this.deferPromise(() => {
            const vfsPath = '/chugins/' + name;
            this.writeVfs(vfsPath, buf);
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


    replaceCode(code: string): Promise<ReplaceResult> {
        return this.replaceVia('ck_replace_code', ['string'], [code]);
    }

    replaceFile(filename: string): Promise<ReplaceResult> {
        return this.replaceVia('ck_replace_file', ['string'], [filename]);
    }

    replaceFileWithArgs(filename: string, colonSeparatedArgs: string): Promise<ReplaceResult> {
        return this.replaceVia('ck_replace_file_with_args', ['string', 'string'],
            [filename, colonSeparatedArgs]);
    }

    removeLastCode(): Promise<number> {
        return this.deferPromise(() => {
            const shredID: number = this.module!.ccall('ck_remove_last_code', 'number', [], []);
            if (!shredID) return Promise.reject(new Error('removeLastCode failed'));
            return shredID;
        });
    }

    removeShred(shredID: number): Promise<number> {
        return this.deferPromise(() => {
            const removed: number = this.module!.ccall('ck_remove_shred', 'number', ['number'], [shredID]);
            if (!removed) return Promise.reject(new Error('removeShred failed'));
            return removed;
        });
    }

    isShredActive(shredID: number): Promise<number> {
        return this.deferPromise(() =>
            this.module!.ccall('ck_is_shred_active', 'number', ['number'], [shredID])
        );
    }

    runFileWithArgs(filename: string, colonSeparatedArgs: string): Promise<RunResult> {
        return this.deferPromise(() => {
            const shredId = this.module!.ccall('ck_run_file_with_args', 'number',
                ['string', 'string'], [filename, colonSeparatedArgs]);
            return new RunResult(shredId, () => this.getLastError());
        });
    }

    now(): Promise<number> {
        return this.deferPromise(() => this.getCurrentTime());
    }


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


    clearChuckInstance(): void {
        this.defer(() => this.module!.ccall('ck_clear_instance', null, [], []));
    }
    clearGlobals(): void {
        this.defer(() => this.module!.ccall('ck_clear_globals', null, [], []));
    }
    reset(): Promise<void> {
        this.clearChuckInstance();
        this.clearGlobals();
        this.defer(() => this.module!.ccall('ck_reset_graphics', null, [], []));
        // ck_reset_graphics re-binds render_pass next frame; a shred spawned in the
        // same batch would draw against a stale scene_id. Yield one frame first.
        return new Promise((resolve) => {
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
            else setTimeout(resolve, 16);
        });
    }

    private releaseCanvas(canvas: HTMLCanvasElement | null): void {
        if (!canvas) return;
        const owner = canvas as any;

        owner._chuglParentObserver?.disconnect();
        delete owner._chuglParentObserver;

        const wrapper = owner._chuglWrapper;
        if (wrapper?.parentElement) {
            wrapper.parentElement.insertBefore(canvas, wrapper);
            wrapper.parentElement.removeChild(wrapper);
        }
        delete owner._chuglWrapper;

        (canvas.getContext('webgpu') as GPUCanvasContext | null)?.unconfigure();
    }

    destroy(): void {
        this._teardown.abort();
        if (!this.module) return;

        // Must precede teardown: the loop would render against freed state.
        this.module.ccall('ck_stop_render_loop', null, [], []);

        this.module.ccall('ck_clear_instance', null, [], []);
        this.module.ccall('ck_clear_globals', null, [], []);

        if (this._audioNode) { this._audioNode.disconnect(); this._audioNode = null; }
        if (this._audioCtx) { this._audioCtx.close(); this._audioCtx = null; }
        this._audioReady = null;

        this.releaseCanvas(this.module.canvas as HTMLCanvasElement);

        this.flushCallbacks();

        this.module = null;
        this.isReady = false;
        this.deferQueue = [];
        this.callbacks = {};
        this.eventListeners = {};
        this.loadedChuginSet = {};
        if (this._micSource) { try { this._micSource.disconnect(); } catch { /* ignore */ } this._micSource = null; }
        if (this._micStream) {
            this._micStream.getTracks().forEach((t) => t.stop());
            this._micStream = null;
        }
        this._printCallback = null;

        console.log('[WebChuGL] Instance destroyed');
    }


    connect(destination: AudioNode): void {
        if (this._audioNode) this._audioNode.connect(destination);
    }
    disconnect(): void {
        if (this._audioNode) this._audioNode.disconnect();
    }


    private static readonly CHUMP_MANIFEST = 'https://chuck.stanford.edu/release/chump/manifest/v1/manifest.json';
    private static _manifestCache: Promise<ChumpManifest> | null = null;

    private static fetchManifest(): Promise<ChumpManifest> {
        if (ChucK._manifestCache) return ChucK._manifestCache;
        ChucK._manifestCache = ChucK.fetchOk(ChucK.CHUMP_MANIFEST)
            .then((r) => r.json())
            .catch((err) => {
                ChucK._manifestCache = null;
                throw err;
            });
        return ChucK._manifestCache;
    }

    private static fetchBuf(url: string): Promise<ArrayBuffer> {
        return ChucK.fetchOk(url).then((r) => r.arrayBuffer());
    }

    private static fetchOk(url: string): Promise<Response> {
        return fetch(url).then((r) => {
            if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + url);
            return r;
        });
    }

    private static compareSemver(a: string, b: string): number {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const diff = (pa[i] || 0) - (pb[i] || 0);
            if (diff !== 0) return diff;
        }
        return 0;
    }

    loadPackage(name: string, version?: string, url?: string): Promise<string> {
        if (!name || !/^[a-zA-Z0-9_@\/-]+$/.test(name)) {
            return Promise.reject(new Error('Invalid package name: ' + name));
        }
        if (version && !/^[a-zA-Z0-9._-]+$/.test(version)) {
            return Promise.reject(new Error('Invalid package version: ' + version));
        }

        const jszipReady = this.ensureJSZip();

        const zipPromise: Promise<{ zipData: ArrayBuffer; resolvedVersion: string }> =
            url
                ? ChucK.fetchBuf(url)
                    .then((zipData) => ({ zipData, resolvedVersion: version || 'custom' }))
                : ChucK.fetchManifest().then((manifest) => {
                    const pkg = manifest.packages.find(
                        (p) => p.name.toLowerCase() === name.toLowerCase()
                    );
                    if (!pkg) throw new Error('Package not found: ' + name);

                    // Filter to web-compatible versions (os: "any", arch: "all")
                    const webVersions = pkg.versions.filter(
                        (v) => v.os === 'any' && v.arch === 'all'
                    );
                    if (!webVersions.length) {
                        throw new Error('No web-compatible version found for: ' + name
                            + ' (only os:"any" arch:"all" packages are supported)');
                    }

                    let entry: ChumpVersionEntry;
                    if (version) {
                        const match = webVersions.find((v) => v.version === version);
                        if (!match) throw new Error('Version ' + version + ' not found for: ' + name);
                        entry = match;
                    } else {
                        webVersions.sort((a, b) => ChucK.compareSemver(a.version, b.version));
                        entry = webVersions[webVersions.length - 1];
                    }

                    if (!entry.files.length || !entry.files[0].url) {
                        throw new Error('No download URL for ' + name + '@' + entry.version);
                    }

                    return ChucK.fetchBuf(entry.files[0].url)
                        .then((zipData) => ({ zipData, resolvedVersion: entry.version }));
                });

        return Promise.all([jszipReady, zipPromise]).then(([, { zipData, resolvedVersion }]) =>
            JSZip.loadAsync(zipData).then((zip) => ({ zip, resolvedVersion }))
        ).then(({ zip, resolvedVersion }) => {
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
                        this.writeVfs(vfsPath, content);
                    });
                });
            })).then(() => resolvedVersion);
        }).then((resolvedVersion) => {
            console.log('[WebChuGL] Package loaded: ' + name + '@' + resolvedVersion);
            return name;
        });
    }
}

export const initWebChuGL = ChucK._create;
