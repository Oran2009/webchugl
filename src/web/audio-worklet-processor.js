/**
 * WebChuGL Audio Worklet Processor
 *
 * Reads audio samples from a lock-free ring buffer in WASM shared memory
 * and writes them to Web Audio output. Optionally writes microphone input
 * to an input ring buffer for ChucK's ADC.
 *
 * Ring buffer format: interleaved stereo [L0, R0, L1, R1, ...]
 * Positions are sample counts (not byte offsets), monotonically increasing.
 */
class ChucKProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.ready = false;
        this.port.onmessage = (e) => {
            const d = e.data;
            // Output ring buffer views (main thread writes, we read)
            this.outBuf = new Float32Array(d.sab, d.outBufOffset, d.capacity * 2);
            this.outWritePos = new Uint32Array(d.sab, d.outWritePosOffset, 1);
            this.outReadPos = new Uint32Array(d.sab, d.outReadPosOffset, 1);
            // Input ring buffer views (we write, main thread reads)
            this.inBuf = new Float32Array(d.sab, d.inBufOffset, d.capacity * 2);
            this.inWritePos = new Uint32Array(d.sab, d.inWritePosOffset, 1);
            this.inReadPos = new Uint32Array(d.sab, d.inReadPosOffset, 1);
            this.capacity = d.capacity;
            this.ready = true;
        };
    }

    process(inputs, outputs) {
        if (!this.ready) return true;

        const cap = this.capacity;
        const outL = outputs[0][0];
        const outR = outputs[0][1];
        const len = outL ? outL.length : 128;

        // Read from output ring buffer → Web Audio output
        for (let i = 0; i < len; i++) {
            const wp = Atomics.load(this.outWritePos, 0);
            const rp = Atomics.load(this.outReadPos, 0);
            if (rp !== wp) {
                const idx = (rp % cap) * 2;
                if (outL) outL[i] = this.outBuf[idx];
                if (outR) outR[i] = this.outBuf[idx + 1];
                Atomics.store(this.outReadPos, 0, rp + 1);
            } else {
                if (outL) outL[i] = 0;
                if (outR) outR[i] = 0;
            }
        }

        // Write microphone input → input ring buffer
        if (inputs[0] && inputs[0].length >= 2 && inputs[0][0].length > 0) {
            const inL = inputs[0][0];
            const inR = inputs[0][1] || inL;
            const inLen = inL.length;
            const wrPos = Atomics.load(this.inWritePos, 0);
            const rdPos = Atomics.load(this.inReadPos, 0);
            const available = cap - (wrPos - rdPos);
            const toWrite = Math.min(inLen, available);

            for (let i = 0; i < toWrite; i++) {
                const idx = ((wrPos + i) % cap) * 2;
                this.inBuf[idx] = inL[i];
                this.inBuf[idx + 1] = inR[i];
            }
            Atomics.store(this.inWritePos, 0, wrPos + toWrite);
        }

        return true;
    }
}

registerProcessor('chuck-processor', ChucKProcessor);
