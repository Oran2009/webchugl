// Shared type declarations used by webchugl.ts and webchugl-esm.ts.
// Exported as a module so TypeScript's declaration emitter includes
// them in the published .d.ts files.

// ── Audio configuration options ──────────────────────────────────────────

/** Audio configuration options. */
export interface AudioConfig {
    /** Audio sample rate in Hz. Defaults to `48000`. */
    sampleRate?: number;
    /** Number of output channels. Defaults to `2`. */
    outputChannels?: number;
    /** Number of input channels. Defaults to `2`. */
    inputChannels?: number;
}

// ── Internal config passed to _initWebChuGL ─────────────────────────────

export interface WebChuGLInternalConfig {
    canvas: HTMLCanvasElement;
    baseUrl: string;
    chugins: string[];
    serviceWorker: boolean;
    serviceWorkerUrl?: string;
    audioConfig?: AudioConfig;
    onProgress?: (pct: number) => void;
    onError?: (msg: string) => void;
    onReady?: () => void;
}

// ── Shred info returned by getActiveShreds ──────────────────────────────

/** Information about an active shred in the ChucK VM. */
export interface ShredInfo {
    id: number;
    name: string;
}

/** Result of a replace operation (replaceCode, replaceFile, etc.). */
export interface ReplaceResult {
    oldShred: number;
    newShred: number;
}

/** Information about a global variable in the ChucK VM. */
export interface GlobalVariableInfo {
    type: string;
    name: string;
}

// ============================================================================
// ChucK Interface
// ============================================================================

/**
 * The ChucK instance returned by `ChuGL.init()`. Provides the full
 * JavaScript-to-ChucK bridge: run code, get/set global variables, listen
 * for events, load files and audio, and more.
 *
 * All methods auto-queue until the ChucK VM is ready, so you can call them
 * immediately after `ChuGL.init()` resolves.
 */
export interface ChucK {
    // ── Code Execution ──────────────────────────────────────────────────

    /**
     * Compile and run ChucK code.
     *
     * @param code - ChucK source code to compile and run.
     * @returns The shred ID on success, 0 on failure.
     */
    runCode(code: string): Promise<number>;

    /**
     * Run a ChucK file. Accepts three kinds of input:
     * - **VFS path** (`/code/main.ck`) -- run directly from the virtual filesystem.
     * - **Filename** (`main.ck`) -- looks up `/code/main.ck` in the VFS.
     * - **URL** (`./main.ck`) -- fetches the file, writes it to the VFS, then runs it.
     *
     * @param pathOrUrl - A VFS path, filename, or URL.
     * @returns The shred ID on success, 0 on failure.
     */
    runFile(pathOrUrl: string): Promise<number>;

    /**
     * Fetch a zip archive, extract to VFS, and run the main ChucK file.
     *
     * @param url - URL of the zip file.
     * @param mainFile - Entry point file path (e.g. `game.ck`).
     * @returns 1 on success, 0 on failure.
     */
    runZip(url: string, mainFile?: string): Promise<number>;

    // ── Virtual Filesystem ──────────────────────────────────────────────

    /** Write a file to the virtual filesystem. */
    createFile(path: string, data: string | ArrayBuffer): void;
    createFile(directory: string, filename: string, data: string | ArrayBuffer): void;

    /** Remove a file or directory from the virtual filesystem recursively. */
    removeFile(path: string): boolean;

    /** Check whether a file or directory exists in the virtual filesystem. */
    fileExists(path: string): boolean;

    /** List all files in a VFS directory (recursively). */
    listFiles(dir?: string): string[];

    /** Fetch a URL and write contents to the VFS. */
    loadFile(url: string, vfsPath?: string): Promise<string>;

    /** Fetch multiple files from a base URL into `/code/`. */
    loadFiles(basePath: string, files: string[]): Promise<string[]>;

    /** Fetch a zip archive and extract all files to `/code/`. */
    loadZip(url: string): Promise<void>;

    // ── Scalar Variables ────────────────────────────────────────────────

    /** Set a global `int` variable in ChucK. */
    setInt(name: string, val: number): void;
    /** Set a global `float` variable in ChucK. */
    setFloat(name: string, val: number): void;
    /** Set a global `string` variable in ChucK. */
    setString(name: string, val: string): void;
    /** Get a global `int` variable from ChucK. */
    getInt(name: string): Promise<number>;
    /** Get a global `float` variable from ChucK. */
    getFloat(name: string): Promise<number>;
    /** Get a global `string` variable from ChucK. */
    getString(name: string): Promise<string>;

    // ── Events ──────────────────────────────────────────────────────────

    /** Signal (wake one waiting shred on) a global ChucK event. */
    signalEvent(name: string): void;
    /** Broadcast (wake all waiting shreds on) a global ChucK event. */
    broadcastEvent(name: string): void;
    /** Listen for a global ChucK event once, then auto-remove the listener. Returns a listener ID. */
    listenForEventOnce(name: string, callback: () => void): number;
    /** Stop listening for a global ChucK event by listener ID. */
    stopListeningForEvent(name: string, listenerId: number): void;
    /** Start listening for a global ChucK event. The callback fires every time the event is broadcast. Returns a listener ID. */
    startListeningForEvent(name: string, callback: () => void): number;

    // ── Int Array Variables ─────────────────────────────────────────────

    /** Set an entire global `int` array in ChucK. */
    setIntArray(name: string, arr: number[]): void;
    /** Get an entire global `int` array from ChucK. */
    getIntArray(name: string): Promise<number[]>;
    /** Set a single value in a global `int` array by index. */
    setIntArrayValue(name: string, index: number, value: number): void;
    /** Get a single value from a global `int` array by index. */
    getIntArrayValue(name: string, index: number): Promise<number>;
    /** Set a value in a global associative `int` array by key. */
    setAssocIntArrayValue(name: string, key: string, value: number): void;
    /** Get a value from a global associative `int` array by key. */
    getAssocIntArrayValue(name: string, key: string): Promise<number>;

    // ── Float Array Variables ───────────────────────────────────────────

    /** Set an entire global `float` array in ChucK. */
    setFloatArray(name: string, arr: number[]): void;
    /** Get an entire global `float` array from ChucK. */
    getFloatArray(name: string): Promise<number[]>;
    /** Set a single value in a global `float` array by index. */
    setFloatArrayValue(name: string, index: number, value: number): void;
    /** Get a single value from a global `float` array by index. */
    getFloatArrayValue(name: string, index: number): Promise<number>;
    /** Set a value in a global associative `float` array by key. */
    setAssocFloatArrayValue(name: string, key: string, value: number): void;
    /** Get a value from a global associative `float` array by key. */
    getAssocFloatArrayValue(name: string, key: string): Promise<number>;

    // ── ChuGin & Package Loading ────────────────────────────────────────

    /** Fetch and load a ChuGin (`.chug.wasm`) from a URL. Returns the ChuGin short name. */
    loadChugin(url: string): Promise<string>;
    /** Get the list of currently loaded ChuGin names. */
    getLoadedChugins(): string[];
    /** Load a ChuMP package by name. Resolves the latest version if none is specified. */
    loadPackage(name: string, version?: string, url?: string): Promise<string>;

    // ── Audio ───────────────────────────────────────────────────────────

    /** Fetch an audio file, decode it to WAV, and write it to the virtual filesystem. */
    loadAudio(url: string, vfsPath?: string): Promise<string>;
    /** Initialize Web MIDI access for ChucK MIDI input/output. */
    initMidi(access: MIDIAccess): void;
    /** Get the audio sample rate, or `null` if audio is not yet initialized. */
    getSampleRate(): number | null;
    /** The underlying Web Audio `AudioContext`, or `null` before audio init. */
    audioContext: AudioContext | null;
    /** The `AudioWorkletNode` running ChucK audio, or `null` before audio init. */
    audioNode: AudioWorkletNode | null;

    // ── VM Introspection ────────────────────────────────────────────────

    /** Get the current ChucK time in samples. */
    getCurrentTime(): number;
    /** Returns the current rendering frames per second. Updated once per second. */
    fps(): number;
    /** Returns the frame delta time in seconds (time since last frame). */
    dt(): number;
    /** Returns the total number of rendered frames since startup. */
    frameCount(): number;
    /** Returns whether the ChucK VM is currently running. */
    isRunning(): boolean;
    /** Get all currently active shreds. */
    getActiveShreds(): ShredInfo[];
    /** Get the error or warning output from the last compile attempt. */
    getLastError(): string;
    /** Get all global variables currently registered in the ChucK VM. */
    getGlobalVariables(): GlobalVariableInfo[];

    // ── Shred Management ────────────────────────────────────────────────

    /** Replace the most recently added shred with new code. */
    replaceCode(code: string): Promise<ReplaceResult>;
    /** Replace the most recently added shred with a file from the VFS. */
    replaceFile(filename: string): Promise<ReplaceResult>;
    /** Replace the most recently added shred with a file and arguments. */
    replaceFileWithArgs(filename: string, colonSeparatedArgs: string): Promise<ReplaceResult>;
    /** Remove the most recently added shred. Returns the removed shred ID. */
    removeLastCode(): Promise<number>;
    /** Remove a shred by ID. Returns the removed shred ID. */
    removeShred(shredID: number): Promise<number>;
    /** Check if a shred is currently active. Returns 1 if active, 0 otherwise. */
    isShredActive(shredID: number): Promise<number>;
    /**
     * Run a ChucK file with colon-separated arguments.
     *
     * @param filename - VFS path to the `.ck` file.
     * @param colonSeparatedArgs - Arguments separated by colons (e.g. `"1:foo:3.14"`).
     * @returns The shred ID on success, 0 on failure.
     */
    runFileWithArgs(filename: string, colonSeparatedArgs: string): Promise<number>;
    /** Get the current ChucK time in samples (async version of `getCurrentTime`). */
    now(): Promise<number>;

    // ── Print Callback ──────────────────────────────────────────────────

    /**
     * Callback for intercepting all ChucK output (both `<<<` print and
     * error/warning messages). Set to a function to capture output, or
     * `null` to restore default `console.log`/`console.error` behavior.
     */
    chuckPrint: ((msg: string) => void) | null;

    // ── VM Engine Parameters ────────────────────────────────────────────

    /** Set a VM engine parameter (int). */
    setParamInt(name: string, val: number): void;
    /** Get a VM engine parameter (int). */
    getParamInt(name: string): number;
    /** Set a VM engine parameter (float). */
    setParamFloat(name: string, val: number): void;
    /** Get a VM engine parameter (float). */
    getParamFloat(name: string): number;
    /** Set a VM engine parameter (string). */
    setParamString(name: string, val: string): void;
    /** Get a VM engine parameter (string). */
    getParamString(name: string): string;

    // ── VM Reset ────────────────────────────────────────────────────────

    /** Remove all shreds and reset the ChucK VM to its initial state. */
    clearChuckInstance(): void;
    /** Clear all global variables in the ChucK VM. */
    clearGlobals(): void;

    // ── Web Audio Graph ─────────────────────────────────────────────────

    /** Connect ChucK audio output to a Web Audio destination node. */
    connect(destination: AudioNode): void;
    /** Disconnect ChucK audio output from all destinations. */
    disconnect(): void;

    // ── Persistent Storage (IndexedDB) ──────────────────────────────────

    /** Save a value to persistent storage (IndexedDB). */
    save(key: string, value: unknown): Promise<void>;
    /** Load a value from persistent storage (IndexedDB). */
    load(key: string): Promise<unknown>;
    /** Delete a value from persistent storage (IndexedDB). */
    delete(key: string): Promise<void>;
    /** List all keys in persistent storage (IndexedDB). */
    listKeys(): Promise<string[]>;
}
