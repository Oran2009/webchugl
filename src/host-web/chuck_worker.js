/**
 * ChucK Web Worker for WebChuGL
 *
 * Runs the ChucK VM in a dedicated Web Worker thread.
 * Communicates with main thread via postMessage.
 */

// Import the Emscripten-generated module
importScripts('webchugl_audio.js');

// WASM module and exports
let Module = null;
let theChuck = null;
let isInitialized = false;

// ChucK API function wrappers
let initChuckInstance = null;
let runChuckCode = null;
let runChuckFile = null;
let processAudio = null;
let getChuckNow = null;

// Audio buffers
let outputBuffer = null;
let outputBufferPtr = null;
let bufferSize = 0;
let numChannels = 2;

/**
 * Initialize the ChucK WASM module
 */
async function initModule(srate, channels) {
    numChannels = channels;

    const moduleConfig = {
        noInitialRun: true,
        noExitRuntime: true,
        print: (text) => {
            self.postMessage({ type: 'print', text: text });
        },
        printErr: (text) => {
            self.postMessage({ type: 'printErr', text: text });
        }
    };

    try {
        Module = await WebChuGLAudio(moduleConfig);

        // Wrap ChucK API functions
        initChuckInstance = Module.cwrap('initChuckInstance', 'number', ['number', 'number', 'number']);
        runChuckCode = Module.cwrap('runChuckCode', 'number', ['number', 'string']);
        runChuckFile = Module.cwrap('runChuckFile', 'number', ['number', 'string']);
        processAudio = Module.cwrap('processChuckAudio', null, ['number', 'number', 'number', 'number', 'number']);
        getChuckNow = Module.cwrap('getChuckNow', 'number', ['number']);

        // Create ChucK instance
        theChuck = initChuckInstance(1, srate, numChannels);

        isInitialized = true;
        self.postMessage({ type: 'ready' });

    } catch (err) {
        self.postMessage({ type: 'error', message: err.toString() });
    }
}

/**
 * Process audio and return samples
 */
function processAudioSamples(numFrames) {
    if (!isInitialized || !theChuck) {
        return new Float32Array(numFrames * numChannels);
    }

    const requiredSize = numFrames * numChannels;

    // Allocate WASM buffer if needed (reusable)
    if (bufferSize < requiredSize) {
        if (outputBufferPtr) {
            Module._free(outputBufferPtr);
        }
        outputBufferPtr = Module._malloc(requiredSize * 4); // 4 bytes per float
        bufferSize = requiredSize;
    }

    // Process audio through ChucK
    processAudio(
        theChuck,
        0,              // input buffer (null)
        outputBufferPtr,
        numFrames,
        numChannels
    );

    // Create a NEW Float32Array for each call (since we transfer it)
    // Copy from WASM heap into the new array
    const result = new Float32Array(requiredSize);
    result.set(new Float32Array(
        Module.HEAPF32.buffer,
        outputBufferPtr,
        requiredSize
    ));

    return result;
}

// Handle messages from main thread
self.onmessage = function(event) {
    const msg = event.data;

    switch (msg.type) {
        case 'init':
            initModule(msg.srate, msg.numChannels || 2);
            break;

        case 'run':
            if (isInitialized && theChuck) {
                const result = runChuckCode(theChuck, msg.code);
                self.postMessage({
                    type: 'runComplete',
                    success: result === 1,
                    shredId: result
                });
            }
            break;

        case 'process':
            // Process audio and send back samples
            const samples = processAudioSamples(msg.numFrames);
            self.postMessage({
                type: 'audio',
                samples: samples,
                requestId: msg.requestId
            }, [samples.buffer]); // Transfer buffer for performance
            break;

        case 'getNow':
            if (isInitialized && theChuck) {
                const now = getChuckNow(theChuck);
                self.postMessage({ type: 'now', value: now });
            }
            break;
    }
};

self.postMessage({ type: 'workerReady' });
