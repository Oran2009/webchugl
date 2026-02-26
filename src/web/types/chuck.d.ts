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

    setInt(name: string, val: number): void;
    setFloat(name: string, val: number): void;
    setString(name: string, val: string): void;
    getInt(name: string): Promise<number>;
    getFloat(name: string): Promise<number>;
    getString(name: string): Promise<string>;

    // ── Events ──────────────────────────────────────────────────────────

    signalEvent(name: string): void;
    broadcastEvent(name: string): void;
    listenForEventOnce(name: string, callback: () => void): number;
    stopListeningForEvent(name: string, listenerId: number): void;
    startListeningForEvent(name: string, callback: () => void): number;

    // ── Int Array Variables ─────────────────────────────────────────────

    setIntArray(name: string, arr: number[]): void;
    getIntArray(name: string): Promise<number[]>;
    setIntArrayValue(name: string, index: number, value: number): void;
    getIntArrayValue(name: string, index: number): Promise<number>;
    setAssocIntArrayValue(name: string, key: string, value: number): void;
    getAssocIntArrayValue(name: string, key: string): Promise<number>;

    // ── Float Array Variables ───────────────────────────────────────────

    setFloatArray(name: string, arr: number[]): void;
    getFloatArray(name: string): Promise<number[]>;
    setFloatArrayValue(name: string, index: number, value: number): void;
    getFloatArrayValue(name: string, index: number): Promise<number>;
    setAssocFloatArrayValue(name: string, key: string, value: number): void;
    getAssocFloatArrayValue(name: string, key: string): Promise<number>;

    // ── ChuGin & Package Loading ────────────────────────────────────────

    loadChugin(url: string): Promise<string>;
    getLoadedChugins(): string[];
    loadPackage(name: string, version?: string, url?: string): Promise<string>;

    // ── Audio ───────────────────────────────────────────────────────────

    loadAudio(url: string, vfsPath?: string): Promise<string>;
    initMidi(access: MIDIAccess): void;
    getSampleRate(): number | null;
    audioContext: AudioContext | null;
    audioNode: AudioWorkletNode | null;

    // ── VM Introspection ────────────────────────────────────────────────

    getCurrentTime(): number;
    /** Returns the current rendering frames per second. Updated once per second. */
    fps(): number;
    /** Returns the frame delta time in seconds (time since last frame). */
    dt(): number;
    /** Returns the total number of rendered frames since startup. */
    frameCount(): number;
    /** Returns whether the ChucK VM is currently running. */
    isRunning(): boolean;
    getActiveShreds(): ShredInfo[];
    getLastError(): string;
    getGlobalVariables(): GlobalVariableInfo[];

    // ── Shred Management ────────────────────────────────────────────────

    replaceCode(code: string): Promise<ReplaceResult>;
    replaceFile(filename: string): Promise<ReplaceResult>;
    replaceFileWithArgs(filename: string, colonSeparatedArgs: string): Promise<ReplaceResult>;
    removeLastCode(): Promise<number>;
    removeShred(shredID: number): Promise<number>;
    isShredActive(shredID: number): Promise<number>;
    runFileWithArgs(filename: string, colonSeparatedArgs: string): Promise<number>;
    now(): Promise<number>;

    // ── Print Callback ──────────────────────────────────────────────────

    /**
     * Callback for intercepting all ChucK output (both `<<<` print and
     * error/warning messages). Set to a function to capture output, or
     * `null` to restore default `console.log`/`console.error` behavior.
     */
    chuckPrint: ((msg: string) => void) | null;

    // ── VM Engine Parameters ────────────────────────────────────────────

    setParamInt(name: string, val: number): void;
    getParamInt(name: string): number;
    setParamFloat(name: string, val: number): void;
    getParamFloat(name: string): number;
    setParamString(name: string, val: string): void;
    getParamString(name: string): string;

    // ── VM Reset ────────────────────────────────────────────────────────

    clearChuckInstance(): void;
    clearGlobals(): void;

    // ── Web Audio Graph ─────────────────────────────────────────────────

    connect(destination: AudioNode): void;
    disconnect(): void;

    // ── Persistent Storage (IndexedDB) ──────────────────────────────────

    save(key: string, value: unknown): Promise<void>;
    load(key: string): Promise<unknown>;
    delete(key: string): Promise<void>;
    listKeys(): Promise<string[]>;
}
