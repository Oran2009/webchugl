/**
 * Audio: the AudioWorklet that drains ChucK's ring buffer, and WAV encoding
 * for `loadAudio`.
 */

export interface RingBufferParams {
    sab: SharedArrayBuffer;
    outBufPtr: number; outWritePosPtr: number; outReadPosPtr: number;
    inBufPtr: number; inWritePosPtr: number; inReadPosPtr: number;
    capacity: number;
    sampleRate: number; outChannels: number; inChannels: number;
}

/**
 * Create the AudioContext and start the worklet reading `params`'s ring buffer.
 * The context is returned synchronously so callers can report the sample rate
 * before the worklet module finishes loading; `ready` resolves with the node,
 * or null if the worklet failed.
 */
export function startAudio(
    params: RingBufferParams,
    baseUrl: string,
    signal: AbortSignal,
): { ctx: AudioContext; ready: Promise<AudioWorkletNode | null> } {
    const { sampleRate, outChannels, inChannels } = params;
    const ctx = new AudioContext({ sampleRate, latencyHint: 'interactive' });

    const ready = ctx.audioWorklet.addModule(baseUrl + 'audio-worklet-processor.js').then(() => {
        const node = new AudioWorkletNode(ctx, 'chuck-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [outChannels],
            channelCount: inChannels,
            channelCountMode: 'explicit',
        });

        node.port.postMessage({
            sab: params.sab,
            outBufOffset: params.outBufPtr,
            outWritePosOffset: params.outWritePosPtr,
            outReadPosOffset: params.outReadPosPtr,
            inBufOffset: params.inBufPtr,
            inWritePosOffset: params.inWritePosPtr,
            inReadPosOffset: params.inReadPosPtr,
            capacity: params.capacity,
            outChannels,
            inChannels,
        });

        node.connect(ctx.destination);
        armAutoResume(ctx, signal);
        console.log('[WebChuGL] Audio initialized (JS AudioWorklet)');
        return node;
    }).catch((err) => {
        console.error('[WebChuGL] Audio worklet failed: ' + err.message);
        return null;
    });

    return { ctx, ready };
}

/**
 * Resume the context on the next user gesture whenever it is not running. A
 * context can re-suspend long after the first resume (backgrounded tab, device
 * change), so the listeners re-arm on any non-running state. `signal` removes
 * them for good on teardown.
 */
function armAutoResume(ctx: AudioContext, signal: AbortSignal): void {
    let attached = false;
    const onGesture = (): void => {
        if (ctx.state === 'running') return;
        ctx.resume().catch((err) => console.warn('[WebChuGL] AudioContext resume failed:', err));
    };
    const EVENTS = ['click', 'keydown', 'touchstart'] as const;
    const attach = (): void => {
        if (attached) return;
        for (const e of EVENTS) document.addEventListener(e, onGesture, { signal });
        attached = true;
    };
    const detach = (): void => {
        if (!attached) return;
        for (const e of EVENTS) document.removeEventListener(e, onGesture);
        attached = false;
    };
    ctx.addEventListener('statechange', () => {
        if (ctx.state === 'running') detach();
        else if (ctx.state === 'suspended') attach();
    }, { signal });
    attach();
}

function writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}

export function audioBufferToWav(audioBuffer: AudioBuffer): ArrayBuffer {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const numSamples = audioBuffer.length;
    const blockAlign = numChannels * 2;
    const dataSize = numSamples * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    const channels: Float32Array[] = [];
    for (let ch = 0; ch < numChannels; ch++) {
        channels.push(audioBuffer.getChannelData(ch));
    }

    let dataOffset = 44;
    for (let i = 0; i < numSamples; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
            const sample = Math.max(-1, Math.min(1, channels[ch][i]));
            view.setInt16(dataOffset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            dataOffset += 2;
        }
    }

    return buffer;
}
