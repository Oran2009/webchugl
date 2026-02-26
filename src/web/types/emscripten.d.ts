/**
 * Type declarations for the Emscripten Module used by WebChuGL.
 *
 * These types cover every property and method accessed on the Emscripten
 * Module object (`_module`) in `webchugl.js` and from C++ via EM_ASM/EM_JS
 * blocks in `webchugl_main.cpp`.
 */

// ---------------------------------------------------------------------------
// Emscripten Filesystem (FS) API — subset used by WebChuGL
// ---------------------------------------------------------------------------

/** Stat result returned by `FS.stat()`. */
interface EmscriptenFSStat {
    mode: number;
}

/** Emscripten virtual filesystem API (subset used by WebChuGL). */
interface EmscriptenFS {
    /** Create a directory in the virtual filesystem. */
    mkdir(path: string): void;

    /** Write a file to the virtual filesystem. */
    writeFile(path: string, data: string | Uint8Array): void;

    /** List entries in a directory (includes `.` and `..`). */
    readdir(path: string): string[];

    /** Get file/directory status. */
    stat(path: string): EmscriptenFSStat;

    /** Delete a file from the virtual filesystem. */
    unlink(path: string): void;

    /** Remove an empty directory from the virtual filesystem. */
    rmdir(path: string): void;

    /** Test whether a mode value indicates a directory. */
    isDir(mode: number): boolean;
}

// ---------------------------------------------------------------------------
// WebAssembly Memory
// ---------------------------------------------------------------------------

/** Emscripten WebAssembly memory object. */
interface EmscriptenWasmMemory {
    /** The underlying buffer (SharedArrayBuffer when built with -pthread). */
    buffer: SharedArrayBuffer | ArrayBuffer;
}

// ---------------------------------------------------------------------------
// EmscriptenModule
// ---------------------------------------------------------------------------

/** Audio configuration passed to the WASM module via `_audioConfig`. */
interface WebChuGLAudioConfig {
    sampleRate: number;
    outChannels: number;
    inChannels: number;
}

/** Event listener entry stored in `_ckEventListeners`. */
interface CkEventListenerEntry {
    callback: () => void;
    once: boolean;
}

/**
 * The Emscripten Module object as configured and used by WebChuGL.
 *
 * Includes standard Emscripten properties (`ccall`, `callMain`, `FS`, etc.)
 * and custom WebChuGL extensions (`_audioConfig`, `_ckCallbacks`, etc.).
 */
interface EmscriptenModule {
    // -- Standard Emscripten properties ------------------------------------

    /**
     * Call a compiled C/C++ function by name.
     *
     * @param ident   - The exported function name (e.g. `'ck_run_code'`).
     * @param returnType - Return type: `'number'`, `'string'`, `'boolean'`, or `null`/`undefined` for void.
     * @param argTypes   - Array of argument types: `'number'`, `'string'`, `'array'`, `'boolean'`.
     * @param args       - Array of argument values matching `argTypes`.
     * @returns The return value from the C/C++ function.
     */
    ccall(
        ident: string,
        returnType: string | null | undefined,
        argTypes: string[],
        args: unknown[],
    ): any;

    /** Invoke the C/C++ `main()` function with the given arguments. */
    callMain(args: string[]): void;

    /** Emscripten virtual filesystem API. */
    FS: EmscriptenFS;

    /** The canvas element used for WebGPU rendering. */
    canvas: HTMLCanvasElement;

    /** The WebAssembly memory object (accessed from EM_ASM for SharedArrayBuffer). */
    wasmMemory: EmscriptenWasmMemory;

    // -- Emscripten Module configuration hooks -----------------------------

    /** When `true`, prevents automatic invocation of `main()` on module load. */
    noInitialRun: boolean;

    /**
     * Resolve the URL for a file needed by the runtime (e.g. `.wasm`, `.worker.js`).
     *
     * @param path - The filename requested by Emscripten.
     * @returns The resolved URL string.
     */
    locateFile(path: string): string;

    /** Called for `stdout` output from the C/C++ program. */
    print(text: string): void;

    /** Called for `stderr` output from the C/C++ program. */
    printErr(text: string): void;

    /** Called by Emscripten to report loading/compilation status. */
    setStatus(text: string): void;

    /** Array of functions to run before the main program executes. */
    preRun: Array<(mod: EmscriptenModule) => void>;

    // -- Custom WebChuGL properties ----------------------------------------

    /** Audio configuration (sample rate, channel counts). */
    _audioConfig: WebChuGLAudioConfig;

    /**
     * Pending callback map for async global variable getters.
     * C++ resolves callbacks by ID via `_ck_resolve_int`, `_ck_resolve_float`, etc.
     */
    _ckCallbacks: Record<number, (value: any) => void>;

    /**
     * Registered ChucK event listeners.
     * C++ dispatches events by ID via `_ck_dispatch_event`.
     */
    _ckEventListeners: Record<number, CkEventListenerEntry>;

    /**
     * Initialize the audio subsystem. Called from C++ `initAudio()` via EM_ASM.
     *
     * Sets up an `AudioContext`, creates an `AudioWorkletNode` running the
     * chuck-processor, and connects it to the ring buffers in WASM memory.
     *
     * @param sab            - The SharedArrayBuffer backing WASM memory.
     * @param outBufPtr      - Byte offset of the output ring buffer.
     * @param outWritePosPtr - Byte offset of the output write position atomic.
     * @param outReadPosPtr  - Byte offset of the output read position atomic.
     * @param inBufPtr       - Byte offset of the input ring buffer.
     * @param inWritePosPtr  - Byte offset of the input write position atomic.
     * @param inReadPosPtr   - Byte offset of the input read position atomic.
     * @param capacity       - Ring buffer capacity in frames.
     * @param needsMic       - Non-zero if microphone input is requested.
     * @param sampleRate     - Audio sample rate in Hz.
     * @param outChannels    - Number of output audio channels.
     * @param inChannels     - Number of input audio channels.
     */
    _initAudio(
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
        inChannels: number,
    ): void;

    /**
     * Connect the microphone to the audio worklet on demand.
     * Called from C++ (via EM_ASM) when compiled code uses `adc` after init.
     */
    _connectMic(): void;

    /**
     * Callback for ChucK print output (`chout` / `<<< >>>`).
     * Set to a function to intercept print messages, or `null` to use `console.log`.
     */
    _onChuckPrint: ((text: string) => void) | null;

    /** Pre-acquired WebGPU adapter, set before `callMain()`. */
    _preAdapter: GPUAdapter;

    /** Pre-acquired WebGPU device, set before `callMain()`. */
    _preDevice: GPUDevice;
}

// ---------------------------------------------------------------------------
// createWebChuGL — the Emscripten MODULARIZE factory function
// ---------------------------------------------------------------------------

/**
 * Factory function generated by Emscripten with `-sMODULARIZE -sEXPORT_NAME=createWebChuGL`.
 *
 * Accepts a partial module configuration object, initializes the WASM runtime,
 * and resolves with the fully initialized `EmscriptenModule`.
 *
 * @param config - Partial module configuration (hooks, canvas, custom properties).
 * @returns A promise that resolves to the initialized Emscripten Module.
 */
declare function createWebChuGL(
    config: Partial<EmscriptenModule>,
): Promise<EmscriptenModule>;
