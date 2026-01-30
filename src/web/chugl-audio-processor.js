/*----------------------------------------------------------------------------
  WebChuGL Audio Worklet Processor

  Runs on the audio rendering thread. Reads audio samples from the output
  ring buffer (written by WASM main thread) and writes microphone input
  to the input ring buffer.

  Ring buffer format: Interleaved stereo [L0, R0, L1, R1, ...]
  Uses SharedArrayBuffer for lock-free communication with WASM.

  Based on WebChucK's approach but simplified for ChuGL's needs where
  the ChucK VM runs on the main thread (for graphics support).
-----------------------------------------------------------------------------*/

class ChuGLAudioProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();

        // Ring buffer configuration from WASM
        const opts = options.processorOptions;
        this.ringCapacity = opts.ringCapacity;

        // Byte offsets into WASM memory
        this.outputBufferOffset = opts.outputBufferPtr;
        this.outputWritePosOffset = opts.outputWritePosPtr;
        this.outputReadPosOffset = opts.outputReadPosPtr;
        this.inputBufferOffset = opts.inputBufferPtr;
        this.inputWritePosOffset = opts.inputWritePosPtr;
        this.inputReadPosOffset = opts.inputReadPosPtr;

        // Store the SharedArrayBuffer
        this.wasmMemory = opts.wasmMemory;

        // Create typed array views - these need to be recreated if memory grows
        this._updateViews();

        console.log('[ChuGL Audio] Processor initialized, ring capacity:', this.ringCapacity);
    }

    _updateViews() {
        // Float32 view for audio buffers
        this.heapF32 = new Float32Array(this.wasmMemory);
        // Uint32 view for atomic read/write positions
        this.heapU32 = new Uint32Array(this.wasmMemory);

        // Pre-calculate array indices (divide byte offset by element size)
        this.outputBufferIdx = this.outputBufferOffset >> 2;  // /4 for float32
        this.outputWritePosIdx = this.outputWritePosOffset >> 2;
        this.outputReadPosIdx = this.outputReadPosOffset >> 2;
        this.inputBufferIdx = this.inputBufferOffset >> 2;
        this.inputWritePosIdx = this.inputWritePosOffset >> 2;
        this.inputReadPosIdx = this.inputReadPosOffset >> 2;
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        if (!output || output.length < 2) return true;

        const outputLeft = output[0];
        const outputRight = output[1];
        const numSamples = outputLeft.length;  // Usually 128

        // Check if memory has grown and update views if needed
        if (this.heapF32.buffer !== this.wasmMemory) {
            this._updateViews();
        }

        // Read from output ring buffer (WASM main thread -> Audio Worklet)
        const writePos = Atomics.load(this.heapU32, this.outputWritePosIdx);
        let readPos = Atomics.load(this.heapU32, this.outputReadPosIdx);
        const available = writePos - readPos;

        for (let i = 0; i < numSamples; i++) {
            if (i < available) {
                // Ring buffer stores interleaved stereo: [L0, R0, L1, R1, ...]
                const idx = this.outputBufferIdx + ((readPos + i) % this.ringCapacity) * 2;
                outputLeft[i] = this.heapF32[idx];
                outputRight[i] = this.heapF32[idx + 1];
            } else {
                // Buffer underrun - output silence
                outputLeft[i] = 0;
                outputRight[i] = 0;
            }
        }

        // Update read position atomically
        const samplesToConsume = Math.min(numSamples, available);
        if (samplesToConsume > 0) {
            Atomics.store(this.heapU32, this.outputReadPosIdx, readPos + samplesToConsume);
        }

        // Write microphone input to input ring buffer (Audio Worklet -> WASM main thread)
        const input = inputs[0];
        if (input && input.length >= 2 && input[0].length > 0) {
            const inputLeft = input[0];
            const inputRight = input[1] || input[0];  // Mono fallback
            const inputSamples = inputLeft.length;

            let inputWritePos = Atomics.load(this.heapU32, this.inputWritePosIdx);
            const inputReadPos = Atomics.load(this.heapU32, this.inputReadPosIdx);
            const inputAvailable = this.ringCapacity - (inputWritePos - inputReadPos);

            const samplesToWrite = Math.min(inputSamples, inputAvailable);
            for (let i = 0; i < samplesToWrite; i++) {
                // Store as interleaved stereo
                const idx = this.inputBufferIdx + ((inputWritePos + i) % this.ringCapacity) * 2;
                this.heapF32[idx] = inputLeft[i];
                this.heapF32[idx + 1] = inputRight[i];
            }

            if (samplesToWrite > 0) {
                Atomics.store(this.heapU32, this.inputWritePosIdx, inputWritePos + samplesToWrite);
            }
        }

        return true;
    }
}

registerProcessor('chugl-audio-processor', ChuGLAudioProcessor);
