/**
 * WebChuGL - Main Thread Orchestrator
 *
 * Manages the Audio Worklet (ChucK) and Graphics (ChuGL) threads.
 */

class WebChuGL {
    constructor(options = {}) {
        this.audioContext = null;
        this.chuckNode = null;
        this.graphicsModule = null;

        this.sampleRate = options.sampleRate || 48000;
        this.numChannels = options.numChannels || 2;

        // Callbacks
        this.onReady = options.onReady || (() => {});
        this.onPrint = options.onPrint || console.log;
        this.onError = options.onError || console.error;

        // State
        this.isAudioReady = false;
        this.isGraphicsReady = false;

        // Command queue from audio worklet
        this.pendingCommands = [];
    }

    /**
     * Initialize WebChuGL with audio worklet and graphics
     */
    async init(canvasId, audioWasmUrl, graphicsWasmUrl, programCode) {
        console.log('[WebChuGL] Initializing...');

        try {
            // Initialize audio (ChucK in Audio Worklet)
            await this.initAudio(audioWasmUrl);

            // Initialize graphics (ChuGL on main thread)
            await this.initGraphics(canvasId, graphicsWasmUrl);

            // Run the ChucK program
            if (programCode) {
                this.runCode(programCode);
            }

            this.onReady();

        } catch (err) {
            this.onError('Initialization failed: ' + err.message);
            throw err;
        }
    }

    /**
     * Initialize Audio Worklet with ChucK
     */
    async initAudio(wasmUrl) {
        console.log('[WebChuGL] Initializing audio...');

        // Create AudioContext
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: this.sampleRate
        });

        // Load WASM binary
        console.log('[WebChuGL] Loading audio WASM from:', wasmUrl);
        const wasmResponse = await fetch(wasmUrl);
        const wasmBinary = await wasmResponse.arrayBuffer();

        // Register AudioWorklet module
        console.log('[WebChuGL] Registering AudioWorklet...');
        await this.audioContext.audioWorklet.addModule('chuck_processor.js');

        // Create AudioWorkletNode
        this.chuckNode = new AudioWorkletNode(this.audioContext, 'chuck-processor', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [this.numChannels],
            processorOptions: {
                srate: this.sampleRate,
                numOutChannels: this.numChannels,
                wasmBinary: wasmBinary
            }
        });

        // Handle messages from worklet
        this.chuckNode.port.onmessage = this.handleWorkletMessage.bind(this);

        // Connect to destination
        this.chuckNode.connect(this.audioContext.destination);

        // Wait for worklet to be ready
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Audio worklet timeout')), 10000);
            const handler = (event) => {
                if (event.data.type === 'ready') {
                    clearTimeout(timeout);
                    this.chuckNode.port.removeEventListener('message', handler);
                    resolve();
                } else if (event.data.type === 'error') {
                    clearTimeout(timeout);
                    reject(new Error(event.data.message));
                }
            };
            this.chuckNode.port.addEventListener('message', handler);
        });

        this.isAudioReady = true;
        console.log('[WebChuGL] Audio initialized');
    }

    /**
     * Initialize Graphics (ChuGL) on main thread
     */
    async initGraphics(canvasId, wasmUrl) {
        console.log('[WebChuGL] Initializing graphics...');

        // For now, we'll load the existing combined module
        // TODO: Create separate graphics-only module

        this.isGraphicsReady = true;
        console.log('[WebChuGL] Graphics initialized');
    }

    /**
     * Handle messages from Audio Worklet
     */
    handleWorkletMessage(event) {
        const msg = event.data;

        switch (msg.type) {
            case 'print':
                this.onPrint(msg.text);
                break;

            case 'printErr':
                this.onError(msg.text);
                break;

            case 'commands':
                // ChuGL commands from ChucK shreds
                this.pendingCommands.push(...msg.commands);
                break;

            case 'runComplete':
                console.log('[WebChuGL] Code execution:', msg.success ? 'success' : 'failed');
                break;

            case 'ready':
                console.log('[WebChuGL] Audio worklet ready');
                break;

            case 'error':
                this.onError('Worklet error: ' + msg.message);
                break;
        }
    }

    /**
     * Run ChucK code
     */
    runCode(code) {
        if (!this.chuckNode) {
            throw new Error('Audio not initialized');
        }
        this.chuckNode.port.postMessage({ type: 'run', code: code });
    }

    /**
     * Run ChucK file from virtual filesystem
     */
    runFile(filename) {
        if (!this.chuckNode) {
            throw new Error('Audio not initialized');
        }
        this.chuckNode.port.postMessage({ type: 'runFile', filename: filename });
    }

    /**
     * Resume audio context (must be called from user interaction)
     */
    async resume() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
    }

    /**
     * Suspend audio
     */
    async suspend() {
        if (this.audioContext) {
            await this.audioContext.suspend();
        }
    }

    /**
     * Clean up resources
     */
    destroy() {
        if (this.chuckNode) {
            this.chuckNode.disconnect();
            this.chuckNode = null;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebChuGL;
} else {
    window.WebChuGL = WebChuGL;
}
