/**
 * ChucK AudioWorkletProcessor for WebChuGL
 *
 * This processor runs the ChucK VM in the Audio Worklet thread,
 * generating audio samples and ChuGL commands.
 */

// Import the Emscripten-generated module loader
importScripts('webchugl_audio.js');

// WASM module and exports (initialized on first message)
let Module = null;
let theChuck = null;
let isInitialized = false;
let messagePort = null;  // Port for communicating with main thread

// ChucK API function wrappers
let initChuckInstance = null;
let runChuckCode = null;
let runChuckFile = null;
let processAudio = null;
let getChuckNow = null;
let setChuckInt = null;
let setChuckFloat = null;

/**
 * Send message to main thread via port
 */
function sendMessage(msg) {
    if (messagePort) {
        messagePort.postMessage(msg);
    }
}

/**
 * Initialize the ChucK WASM module
 */
async function initModule(wasmBinary, srate, preloadedFiles, port) {
    messagePort = port;

    // Create Module configuration
    const moduleConfig = {
        wasmBinary: wasmBinary,
        noInitialRun: true,
        noExitRuntime: true,
        print: (text) => {
            sendMessage({ type: 'print', text: text });
        },
        printErr: (text) => {
            sendMessage({ type: 'printErr', text: text });
        }
    };

    // Import and instantiate the WASM module
    // The actual module loading will be injected by Emscripten
    try {
        Module = await WebChuGLAudio(moduleConfig);

        // Wrap ChucK API functions
        initChuckInstance = Module.cwrap('initChuckInstance', 'number', ['number', 'number', 'number']);
        runChuckCode = Module.cwrap('runChuckCode', 'number', ['number', 'string']);
        runChuckFile = Module.cwrap('runChuckFile', 'number', ['number', 'string']);
        processAudio = Module.cwrap('processChuckAudio', null, ['number', 'number', 'number', 'number', 'number']);
        getChuckNow = Module.cwrap('getChuckNow', 'number', ['number']);

        // Preload files into virtual filesystem
        if (preloadedFiles) {
            for (const file of preloadedFiles) {
                Module.FS.writeFile(file.name, file.data);
            }
        }

        // Create ChucK instance
        theChuck = initChuckInstance(1, srate, 2); // chuckID=1, stereo output

        isInitialized = true;
        sendMessage({ type: 'ready' });

    } catch (err) {
        sendMessage({ type: 'error', message: err.toString() });
    }
}

/**
 * ChucK AudioWorkletProcessor
 */
class ChuckProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();

        this.srate = options.processorOptions.srate || 48000;
        this.numOutChannels = options.processorOptions.numOutChannels || 2;

        // Buffers for audio processing
        this.inBuffer = null;
        this.outBuffer = null;

        // Handle messages from main thread
        this.port.onmessage = this.handleMessage.bind(this);

        // Initialize WASM if binary provided
        if (options.processorOptions.wasmBinary) {
            initModule(
                options.processorOptions.wasmBinary,
                this.srate,
                options.processorOptions.preloadedFiles,
                this.port
            );
        }
    }

    handleMessage(event) {
        const msg = event.data;

        switch (msg.type) {
            case 'run':
                // Run ChucK code
                if (isInitialized && theChuck) {
                    const result = runChuckCode(theChuck, msg.code);
                    this.port.postMessage({
                        type: 'runComplete',
                        success: result === 1,
                        shredId: result
                    });
                }
                break;

            case 'runFile':
                // Run ChucK file from virtual filesystem
                if (isInitialized && theChuck) {
                    const result = runChuckFile(theChuck, msg.filename);
                    this.port.postMessage({
                        type: 'runComplete',
                        success: result === 1,
                        shredId: result
                    });
                }
                break;

            case 'input':
                // Forward input events to ChucK
                // TODO: Implement input forwarding
                break;

            case 'frameComplete':
                // Graphics frame completed
                // TODO: Handle frame synchronization
                break;
        }
    }

    process(inputs, outputs, parameters) {
        if (!isInitialized || !theChuck) {
            // Output silence while not initialized
            return true;
        }

        const output = outputs[0];
        const numSamples = output[0].length; // Usually 128

        // Allocate buffers if needed
        if (!this.outBuffer || this.outBuffer.length !== numSamples * this.numOutChannels) {
            this.outBuffer = new Float32Array(numSamples * this.numOutChannels);
            // Get WASM heap pointer for output buffer
            this.outBufferPtr = Module._malloc(this.outBuffer.byteLength);
        }

        // Process audio through ChucK
        // ChucK uses interleaved stereo format
        processAudio(
            theChuck,
            0,                    // input buffer (null for now)
            this.outBufferPtr,    // output buffer
            numSamples,           // number of frames
            this.numOutChannels   // number of channels
        );

        // Copy from WASM heap to output buffer
        this.outBuffer.set(new Float32Array(
            Module.HEAPF32.buffer,
            this.outBufferPtr,
            numSamples * this.numOutChannels
        ));

        // Deinterleave to separate channels
        for (let ch = 0; ch < Math.min(output.length, this.numOutChannels); ch++) {
            for (let i = 0; i < numSamples; i++) {
                output[ch][i] = this.outBuffer[i * this.numOutChannels + ch];
            }
        }

        return true; // Keep processor alive
    }
}

registerProcessor('chuck-processor', ChuckProcessor);
