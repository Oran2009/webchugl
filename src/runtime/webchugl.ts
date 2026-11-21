// Bundled by esbuild into an ES module; webchugl-esm.ts imports initWebChuGL.

import type { RingBufferParams } from './lib/audio';
import type { AudioConfig, ShredInfo, ReplaceResult, GlobalVariableInfo, WebChuGLInternalConfig, ChuginEntry } from './types/chuck.js';
import { VFS, isBinaryFile } from './lib/vfs';
import { audioBufferToWav, startAudio } from './lib/audio';
import { installMidiAccess } from './lib/midi';
import { Zip } from './lib/zip';
import { initSensors } from './lib/sensors';
import { registerServiceWorker } from './lib/service-worker';

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

function fetchOk(url: string): Promise<Response> {
    return fetch(url).then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + url);
        return r;
    });
}

function fetchBuf(url: string): Promise<ArrayBuffer> {
    return fetchOk(url).then((r) => r.arrayBuffer());
}


class ChucK {
    private _module: WebChuGLModule | null = null;
    private _nextId = 1;
    private _isReady = false;
    private _deferQueue: Array<() => void> = [];
    private _callbacks: Record<number, (value: any) => void> = {};
    private _eventListeners: Record<number, CkEventListenerEntry> = {};
    private _loadedChuginSet: Record<string, boolean> = {};
    private _audioCtx: AudioContext | null = null;
    private _audioNode: AudioWorkletNode | null = null;
    private _audioReady: Promise<void> | null = null;
    private _micStream: MediaStream | null = null;
    private _micSource: MediaStreamAudioSourceNode | null = null;
    private _sampleRate = 48000;
    private _printCallback: ((msg: string) => void) | null = null;
    private _baseUrl: string;
    private _vfs = new VFS(() => this._module);
    private _teardown = new AbortController();

    private constructor(baseUrl: string) {
        this._baseUrl = baseUrl;
    }

    // Calls made before the VM is ready are queued here.

    private _defer(fn: () => void): void {
        if (this._isReady) fn();
        else this._deferQueue.push(fn);
    }

    private _deferPromise<T>(fn: () => T | Promise<T>): Promise<T> {
        if (this._isReady) {
            try { return Promise.resolve(fn()); }
            catch (e) { return Promise.reject(e); }
        }
        return new Promise<T>((resolve, reject) => {
            this._deferQueue.push(() => {
                try { Promise.resolve(fn()).then(resolve, reject); }
                catch (e) { reject(e); }
            });
        });
    }

    // Returns the zip's entry names, each written to / and chugins loaded.
    private _unzipToVfs(url: string): Promise<string[]> {
        return fetchBuf(url).then((zipData) => {
            const zip = Zip.read(zipData);
            return Promise.all(zip.names.map((name) =>
                zip.file(name).then((content) => {
                    this._defer(() => {
                        this._vfs.write('/' + name, content);
                        if (name.endsWith('.chug.wasm')) this._loadChugin('/' + name);
                    });
                })
            )).then(() => zip.names);
        });
    }

    private _runFile(path: string): Promise<RunResult> {
        return this._deferPromise(() => {
            const shredId = this._module!.ccall('ck_run_file', 'number', ['string'], [path]);
            return new RunResult(shredId, () => this.getLastError());
        });
    }

    private _replaceVia(func: string, types: string[], args: unknown[]): Promise<ReplaceResult> {
        return this._deferPromise(() => {
            if (!this._module!.ccall(func, 'number', types, args)) {
                return Promise.reject(new Error(func + ' failed'));
            }
            return {
                oldShred: this._module!.ccall('ck_get_replace_old_shred', 'number', [], []),
                newShred: this._module!.ccall('ck_get_replace_new_shred', 'number', [], []),
            };
        });
    }

    private _flush(): void {
        const queue = this._deferQueue;
        this._deferQueue = [];
        this._isReady = true;
        for (const fn of queue) fn();
    }

    private _flushCallbacks(): void {
        for (const key of Object.keys(this._callbacks)) {
            const id = Number(key);
            this._callbacks[id](undefined);
            delete this._callbacks[id];
        }
    }


    private _ccallSet(func: string, types: string[], args: unknown[]): void {
        this._defer(() => {
            this._module!.ccall(func, 'number', types, args);
        });
    }

    private _ccallGet(func: string, types: string[], args: unknown[]): Promise<any> {
        return this._deferPromise(() => {
            return new Promise((resolve, reject) => {
                const id = this._nextId++;
                this._callbacks[id] = resolve;
                const ret = this._module!.ccall(func, 'number', types.concat('number'), args.concat(id));
                if (!ret) {
                    delete this._callbacks[id];
                    reject(new Error(func + ' failed'));
                }
            });
        });
    }


    private _loadChugin(vfsPath: string): string | null {
        const filename = vfsPath.split('/').pop()!;
        const shortName = filename.replace('.chug.wasm', '');
        if (this._loadedChuginSet[shortName]) return shortName;
        const result = this._module!.ccall('ck_load_chugin', 'number', ['string'], [vfsPath]);
        if (result) {
            this._loadedChuginSet[shortName] = true;
            return shortName;
        }
        return null;
    }

    // Called from C++ via Module._initAudio. Must not throw back into wasm.
    private _handleInitAudio(params: RingBufferParams): void {
        try {
            const { ctx, ready } = startAudio(params, this._baseUrl, this._teardown.signal);
            // Set synchronously so getSampleRate() works before the worklet loads.
            this._audioCtx = ctx;
            this._audioReady = ready.then((node) => { this._audioNode = node; });
        } catch (e) {
            console.error('[WebChuGL] Failed to start audio: ' + (e as Error).message);
        }
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

        const audioConfig: Required<AudioConfig> =
            { sampleRate: 48000, outputChannels: 2, inputChannels: 2 };
        const params = new URLSearchParams(window.location.search);
        const fromUrl: AudioConfig = {
            sampleRate: parseInt(params.get('srate') || '', 10),
            outputChannels: parseInt(params.get('out') || '', 10),
            inputChannels: parseInt(params.get('in') || '', 10),
        };
        // Later sources win; anything missing or non-positive leaves the default.
        for (const source of [fromUrl, config.audioConfig]) {
            for (const key of Object.keys(audioConfig) as Array<keyof AudioConfig>) {
                const value = source?.[key];
                if (value && value > 0) audioConfig[key] = value;
            }
        }
        instance._sampleRate = audioConfig.sampleRate;

        const canvas = config.canvas;
        canvas.addEventListener('webglcontextlost', (e) => e.preventDefault(), false);

        // onError still fires, but init() rejects: a failed factory must not
        // hand back an instance whose calls would queue forever.
        const fail = (msg: string): Promise<ChucK> => {
            onError(msg);
            instance._flushCallbacks();
            return Promise.reject(new Error('[WebChuGL] ' + msg));
        };

        const moduleConfig: Partial<WebChuGLModule> = {
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

            _ckCallbacks: instance._callbacks,
            _ckEventListeners: instance._eventListeners,

            _initAudio: (
                sab: SharedArrayBuffer,
                outBufPtr: number, outWritePosPtr: number, outReadPosPtr: number,
                inBufPtr: number, inWritePosPtr: number, inReadPosPtr: number,
                capacity: number,
                sampleRate: number, outChannels: number, inChannels: number,
            ) => {
                instance._handleInitAudio({
                    sab, outBufPtr, outWritePosPtr, outReadPosPtr,
                    inBufPtr, inWritePosPtr, inReadPosPtr,
                    capacity, sampleRate, outChannels, inChannels,
                });
            },

            preRun: [(mod: WebChuGLModule) => {
                instance._module = mod;
                onProgress(100);
            }],
        };

        // Imported at runtime, not statically: the glue sits next to the wasm at
        // baseUrl, which is only known once init() is called.
        return import(/* @vite-ignore */ baseUrl + 'index.js')
            .then((glue: { default: CreateWebChuGL }) => glue.default(moduleConfig))
            .then((mod) => {
            instance._module = mod;

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
                    fetchBuf(url).then((buf) => {
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
                    instance._module!._preAdapter = adapter;
                    instance._module!._preDevice = device;
                    // Mount before callMain so storage is usable the moment init resolves.
                    return instance._vfs.mount().then(() => {
                        onReady();
                        instance._module!.callMain([]);

                        instance._module!.ccall('chugl_setup_parent_resize', null, [], []);

                        for (const entry of pendingChuginBuffers) {
                            const vfsPath = '/chugins/' + entry.name;
                            instance._vfs.write(vfsPath, entry.buf);
                            if (!instance._loadChugin(vfsPath)) {
                                console.warn('[WebChuGL] Failed to load chugin: ' + vfsPath);
                            }
                        }

                        initSensors(instance, instance._teardown.signal);

                        window.addEventListener('pagehide', () => instance.destroy(),
                                                { signal: instance._teardown.signal });
                        const audioReady = instance._audioReady || Promise.resolve();
                        return audioReady.then(() => {
                            instance._flush();
                            return instance;
                        });
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
        if (!this._module) return 0;
        return this._module.ccall('ck_get_now', 'number', [], []);
    }

    fps(): number {
        if (!this._module) return 0;
        return this._module.ccall('ck_get_fps', 'number', [], []);
    }

    dt(): number {
        if (!this._module) return 0;
        return this._module.ccall('ck_get_dt', 'number', [], []);
    }

    frameCount(): number {
        if (!this._module) return 0;
        return this._module.ccall('ck_get_frame_count', 'number', [], []);
    }

    isRunning(): boolean {
        if (!this._module) return false;
        return !!this._module.ccall('ck_is_vm_running', 'number', [], []);
    }

    getActiveShreds(): ShredInfo[] {
        if (!this._module) return [];
        const json: string = this._module.ccall('ck_get_active_shreds', 'string', [], []);
        try { return JSON.parse(json); } catch { return []; }
    }

    getLastError(): string {
        if (!this._module) return '';
        return this._module.ccall('ck_get_last_compile_output', 'string', [], []);
    }

    getGlobalVariables(): GlobalVariableInfo[] {
        if (!this._module) return [];
        const json: string = this._module.ccall('ck_get_all_globals', 'string', [], []);
        try { return JSON.parse(json); } catch { return []; }
    }

    runCode(code: string): Promise<RunResult> {
        return this._deferPromise(() => {
            const shredId = this._module!.ccall('ck_run_code', 'number', ['string'], [code]);
            return new RunResult(shredId, () => this.getLastError());
        });
    }

    runFile(pathOrUrl: string): Promise<RunResult> {
        if (pathOrUrl[0] === '/') return this._runFile(pathOrUrl);
        const vfsCheck = '/' + pathOrUrl.split('/').pop()!;
        if (this._vfs.exists(vfsCheck)) return this._runFile(vfsCheck);
        return this.loadFile(pathOrUrl).then((vfsPath) => this._runFile(vfsPath));
    }

    runZip(url: string, mainFile?: string): Promise<number> {
        let main = mainFile;
        if (main && main[0] !== '/') main = '/' + main;
        return this._unzipToVfs(url).then((entries) => {
            if (!main) {
                const rootCk = entries.filter((n) => n.endsWith('.ck') && n.indexOf('/') === -1);
                main = entries.indexOf('main.ck') !== -1 ? '/main.ck'
                     : rootCk.length ? '/' + rootCk[0] : '/main.ck';
            }
            return this._deferPromise(() =>
                this._module!.ccall('ck_run_file', 'number', ['string'], [main!]) as number
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
        this._defer(() => this._vfs.write(path, data));
    }

    removeFile(path: string): boolean { return this._vfs.remove(path); }

    fileExists(path: string): boolean { return this._vfs.exists(path); }

    listFiles(dir?: string): string[] { return this._vfs.list(dir || '/code'); }

    loadFile(url: string, vfsPath?: string): Promise<string> {
        let resolvedPath = vfsPath;
        if (!resolvedPath) {
            resolvedPath = '/' + url.split('/').pop()!;
        }
        if (resolvedPath[0] !== '/') resolvedPath = '/' + resolvedPath;
        const bin = isBinaryFile(resolvedPath);
        const isChugin = resolvedPath.endsWith('.chug.wasm');
        const finalPath = resolvedPath;
        return fetchOk(url)
            .then((r): Promise<string | ArrayBuffer> => bin ? r.arrayBuffer() : r.text())
            .then((data) => {
                this._defer(() => {
                    this._vfs.write(finalPath, data);
                    if (isChugin) this._loadChugin(finalPath);
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
            return fetchOk(url)
                .then((r): Promise<string | ArrayBuffer> => bin ? r.arrayBuffer() : r.text())
                .then((data) => {
                    this._defer(() => {
                        this._vfs.write(vfsPath, data);
                        if (isChugin) this._loadChugin(vfsPath);
                    });
                    return vfsPath;
                });
        }));
    }

    loadZip(url: string): Promise<void> {
        return this._unzipToVfs(url)
            .then(() => { console.log('[WebChuGL] Zip extracted: ' + url); });
    }

    setInt(name: string, val: number): void { this._ccallSet('ck_set_int', ['string', 'number'], [name, val]); }
    setFloat(name: string, val: number): void { this._ccallSet('ck_set_float', ['string', 'number'], [name, val]); }
    setString(name: string, val: string): void { this._ccallSet('ck_set_string', ['string', 'string'], [name, val]); }
    getInt(name: string): Promise<number> { return this._ccallGet('ck_get_int', ['string'], [name]); }
    getFloat(name: string): Promise<number> { return this._ccallGet('ck_get_float', ['string'], [name]); }
    getString(name: string): Promise<string> { return this._ccallGet('ck_get_string', ['string'], [name]); }

    signalEvent(name: string): void { this._ccallSet('ck_signal_event', ['string'], [name]); }
    broadcastEvent(name: string): void { this._ccallSet('ck_broadcast_event', ['string'], [name]); }

    startListeningForEvent(name: string, callback: () => void): number {
        const id = this._nextId++;
        this._eventListeners[id] = { callback, once: false };
        this._ccallSet('ck_listen_event', ['string', 'number', 'number'], [name, id, 1]);
        return id;
    }

    listenForEventOnce(name: string, callback: () => void): number {
        const id = this._nextId++;
        this._eventListeners[id] = { callback, once: true };
        this._ccallSet('ck_listen_event', ['string', 'number', 'number'], [name, id, 0]);
        return id;
    }

    stopListeningForEvent(name: string, listenerId: number): void {
        delete this._eventListeners[listenerId];
        this._ccallSet('ck_stop_listening_event', ['string', 'number'], [name, listenerId]);
    }

    setIntArray(name: string, arr: number[]): void {
        this._defer(() => {
            const buf = new Uint8Array(new Int32Array(arr).buffer);
            this._module!.ccall('ck_set_int_array', 'number', ['string', 'array', 'number'], [name, buf, arr.length]);
        });
    }
    setIntArrayValue(name: string, index: number, value: number): void { this._ccallSet('ck_set_int_array_value', ['string', 'number', 'number'], [name, index, value]); }
    setAssocIntArrayValue(name: string, key: string, value: number): void { this._ccallSet('ck_set_assoc_int_array_value', ['string', 'string', 'number'], [name, key, value]); }
    getIntArray(name: string): Promise<number[]> { return this._ccallGet('ck_get_int_array', ['string'], [name]); }
    getIntArrayValue(name: string, index: number): Promise<number> { return this._ccallGet('ck_get_int_array_value', ['string', 'number'], [name, index]); }
    getAssocIntArrayValue(name: string, key: string): Promise<number> { return this._ccallGet('ck_get_assoc_int_array_value', ['string', 'string'], [name, key]); }

    setFloatArray(name: string, arr: number[]): void {
        this._defer(() => {
            const buf = new Uint8Array(new Float64Array(arr).buffer);
            this._module!.ccall('ck_set_float_array', 'number', ['string', 'array', 'number'], [name, buf, arr.length]);
        });
    }
    setFloatArrayValue(name: string, index: number, value: number): void { this._ccallSet('ck_set_float_array_value', ['string', 'number', 'number'], [name, index, value]); }
    setAssocFloatArrayValue(name: string, key: string, value: number): void { this._ccallSet('ck_set_assoc_float_array_value', ['string', 'string', 'number'], [name, key, value]); }
    getFloatArray(name: string): Promise<number[]> { return this._ccallGet('ck_get_float_array', ['string'], [name]); }
    getFloatArrayValue(name: string, index: number): Promise<number> { return this._ccallGet('ck_get_float_array_value', ['string', 'number'], [name, index]); }
    getAssocFloatArrayValue(name: string, key: string): Promise<number> { return this._ccallGet('ck_get_assoc_float_array_value', ['string', 'string'], [name, key]); }

    save(key: string, value: unknown): Promise<void> { return this._vfs.save(key, value); }
    load(key: string): Promise<unknown> { return this._vfs.load(key); }
    delete(key: string): Promise<void> { return this._vfs.delete(key); }
    listKeys(): Promise<string[]> { return this._vfs.listKeys(); }

    initMidi(access: MIDIAccess): void { installMidiAccess(access); }

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
        const mod = this._module as any;
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
                this._defer(() => this._vfs.write(finalPath, wavData));
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
                this._defer(() => this._vfs.write(finalPath, buf));
                console.log('[WebChuGL] Video loaded: ' + finalPath);
                return finalPath;
            });
    }

    loadChugin(url: string): Promise<string> {
        const name = url.split('/').pop()!;
        const shortName = name.replace('.chug.wasm', '');
        if (this._loadedChuginSet[shortName]) return Promise.resolve(shortName);
        return fetchBuf(url).then((buf) => this._deferPromise(() => {
            const vfsPath = '/chugins/' + name;
            this._vfs.write(vfsPath, buf);
            const loaded = this._loadChugin(vfsPath);
            if (!loaded) return Promise.reject(new Error('Failed to load chugin: ' + name));
            return Promise.resolve(loaded);
        }));
    }

    getLoadedChugins(): string[] {
        if (!this._module) return Object.keys(this._loadedChuginSet);
        try {
            const json: string = this._module.ccall('ck_get_loaded_chugins', 'string', [], []);
            return JSON.parse(json);
        } catch {
            return Object.keys(this._loadedChuginSet);
        }
    }

    replaceCode(code: string): Promise<ReplaceResult> {
        return this._replaceVia('ck_replace_code', ['string'], [code]);
    }

    replaceFile(filename: string): Promise<ReplaceResult> {
        return this._replaceVia('ck_replace_file', ['string'], [filename]);
    }

    replaceFileWithArgs(filename: string, colonSeparatedArgs: string): Promise<ReplaceResult> {
        return this._replaceVia('ck_replace_file_with_args', ['string', 'string'],
            [filename, colonSeparatedArgs]);
    }

    removeLastCode(): Promise<number> {
        return this._deferPromise(() => {
            const shredID: number = this._module!.ccall('ck_remove_last_code', 'number', [], []);
            if (!shredID) return Promise.reject(new Error('removeLastCode failed'));
            return shredID;
        });
    }

    removeShred(shredID: number): Promise<number> {
        return this._deferPromise(() => {
            const removed: number = this._module!.ccall('ck_remove_shred', 'number', ['number'], [shredID]);
            if (!removed) return Promise.reject(new Error('removeShred failed'));
            return removed;
        });
    }

    isShredActive(shredID: number): Promise<number> {
        return this._deferPromise(() =>
            this._module!.ccall('ck_is_shred_active', 'number', ['number'], [shredID])
        );
    }

    runFileWithArgs(filename: string, colonSeparatedArgs: string): Promise<RunResult> {
        return this._deferPromise(() => {
            const shredId = this._module!.ccall('ck_run_file_with_args', 'number',
                ['string', 'string'], [filename, colonSeparatedArgs]);
            return new RunResult(shredId, () => this.getLastError());
        });
    }

    now(): Promise<number> {
        return this._deferPromise(() => this.getCurrentTime());
    }

    get chuckPrint(): ((msg: string) => void) | null {
        return this._printCallback;
    }

    set chuckPrint(callback: ((msg: string) => void) | null) {
        if (typeof callback === 'function') {
            this._printCallback = callback;
            this._defer(() => {
                this._module!.ccall('ck_set_print_callback', null, ['number'], [1]);
            });
        } else {
            this._printCallback = null;
            this._defer(() => {
                this._module!.ccall('ck_set_print_callback', null, ['number'], [0]);
            });
        }
    }

    setParamInt(name: string, val: number): void {
        this._defer(() => this._module!.ccall('ck_set_param_int', null, ['string', 'number'], [name, val]));
    }
    getParamInt(name: string): number {
        if (!this._module) return 0;
        return this._module.ccall('ck_get_param_int', 'number', ['string'], [name]);
    }
    setParamFloat(name: string, val: number): void {
        this._defer(() => this._module!.ccall('ck_set_param_float', null, ['string', 'number'], [name, val]));
    }
    getParamFloat(name: string): number {
        if (!this._module) return 0;
        return this._module.ccall('ck_get_param_float', 'number', ['string'], [name]);
    }
    setParamString(name: string, val: string): void {
        this._defer(() => this._module!.ccall('ck_set_param_string', null, ['string', 'string'], [name, val]));
    }
    getParamString(name: string): string {
        if (!this._module) return '';
        return this._module.ccall('ck_get_param_string', 'string', ['string'], [name]);
    }

    clearChuckInstance(): void {
        this._defer(() => this._module!.ccall('ck_clear_instance', null, [], []));
    }
    clearGlobals(): void {
        this._defer(() => this._module!.ccall('ck_clear_globals', null, [], []));
    }
    reset(): Promise<void> {
        this.clearChuckInstance();
        this.clearGlobals();
        this._defer(() => this._module!.ccall('ck_reset_graphics', null, [], []));
        // ck_reset_graphics re-binds render_pass next frame; a shred spawned in the
        // same batch would draw against a stale scene_id. Yield one frame first.
        return new Promise((resolve) => {
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
            else setTimeout(resolve, 16);
        });
    }

    private _releaseCanvas(canvas: HTMLCanvasElement | null): void {
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
        if (!this._module) return;

        // Must precede teardown: the loop would render against freed state.
        this._module.ccall('ck_stop_render_loop', null, [], []);

        this._module.ccall('ck_clear_instance', null, [], []);
        this._module.ccall('ck_clear_globals', null, [], []);

        if (this._audioNode) { this._audioNode.disconnect(); this._audioNode = null; }
        if (this._audioCtx) { this._audioCtx.close(); this._audioCtx = null; }
        this._audioReady = null;

        this._releaseCanvas(this._module.canvas as HTMLCanvasElement);

        this._flushCallbacks();

        this._module = null;
        this._isReady = false;
        this._deferQueue = [];
        this._callbacks = {};
        this._eventListeners = {};
        this._loadedChuginSet = {};
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

}

export const initWebChuGL = ChucK._create;
