/**
 * WebChuGL Audio Worklet Processor
 *
 * Reads audio samples from a lock-free ring buffer in WASM shared memory
 * and writes them to Web Audio output. Optionally writes microphone input
 * to an input ring buffer for ChucK's ADC.
 *
 * Ring buffer format: planar N-channel — each channel is a contiguous plane
 * of `capacity` floats: [ch0: capacity][ch1: capacity]...
 * This matches both ChucK and Web Audio's native planar format,
 * eliminating interleave/deinterleave conversions.
 * Positions are sample counts (not byte offsets), monotonically increasing.
 */
class ChucKProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.ready = false;
        this.port.onmessage = (e) => {
            const d = e.data;
            this.outChannels = d.outChannels;
            this.inChannels = d.inChannels;
            // Output ring buffer views (main thread writes, we read)
            this.outBuf = new Float32Array(d.sab, d.outBufOffset, d.capacity * d.outChannels);
            this.outWritePos = new Uint32Array(d.sab, d.outWritePosOffset, 1);
            this.outReadPos = new Uint32Array(d.sab, d.outReadPosOffset, 1);
            // Input ring buffer views (we write, main thread reads)
            this.inBuf = new Float32Array(d.sab, d.inBufOffset, d.capacity * d.inChannels);
            this.inWritePos = new Uint32Array(d.sab, d.inWritePosOffset, 1);
            this.inReadPos = new Uint32Array(d.sab, d.inReadPosOffset, 1);
            this.capacity = d.capacity;
            this.ready = true;
        };
    }

    process(inputs, outputs) {
        if (!this.ready) return true;

        const cap = this.capacity;
        const outNc = this.outChannels;
        const out = outputs[0];
        if (!out || !out[0]) return true;
        const len = out[0].length;

        // Read from output ring buffer → Web Audio output (planar → planar)
        const rp = Atomics.load(this.outReadPos, 0);
        const wp = Atomics.load(this.outWritePos, 0);
        const available = (wp - rp) >>> 0;
        const toRead = Math.min(len, available);

        const offset = rp % cap;
        const firstChunk = cap - offset;
        for (let ch = 0; ch < outNc && ch < out.length; ch++) {
            const plane = ch * cap;
            if (toRead <= firstChunk) {
                out[ch].set(this.outBuf.subarray(plane + offset, plane + offset + toRead));
            } else {
                out[ch].set(this.outBuf.subarray(plane + offset, plane + cap));
                out[ch].set(this.outBuf.subarray(plane, plane + toRead - firstChunk), firstChunk);
            }
            // Zero any remaining samples beyond what the ring buffer had
            for (let i = toRead; i < len; i++) out[ch][i] = 0;
        }
        // Positions wrap at 2^32 via Uint32Array truncation — matches C++ uint32_t.
        // The (wp - rp) >>> 0 subtraction on read handles wrap correctly.
        Atomics.store(this.outReadPos, 0, (rp + toRead) >>> 0);

        // Write microphone input → input ring buffer (planar → planar)
        const inNc = this.inChannels;
        if (inputs[0] && inputs[0].length >= 1 && inputs[0][0].length > 0) {
            const inp = inputs[0];
            const inLen = inp[0].length;
            const wrPos = Atomics.load(this.inWritePos, 0);
            const rdPos = Atomics.load(this.inReadPos, 0);
            const occupied = (wrPos - rdPos) >>> 0;
            const avail = occupied > cap ? 0 : cap - occupied;
            const toWrite = Math.min(inLen, avail);

            const inOffset = wrPos % cap;
            const inFirstChunk = cap - inOffset;
            for (let ch = 0; ch < inNc; ch++) {
                const plane = ch * cap;
                const src = (ch < inp.length) ? inp[ch] : inp[0];
                if (toWrite <= inFirstChunk) {
                    this.inBuf.set(src.subarray(0, toWrite), plane + inOffset);
                } else {
                    this.inBuf.set(src.subarray(0, inFirstChunk), plane + inOffset);
                    this.inBuf.set(src.subarray(inFirstChunk, toWrite), plane);
                }
            }
            // Position wraps at 2^32 — see output ring buffer comment above.
            Atomics.store(this.inWritePos, 0, (wrPos + toWrite) >>> 0);
        }

        return true;
    }
}

registerProcessor('chuck-processor', ChucKProcessor);
