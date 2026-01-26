/**
 * ChuGL Synchronization for Web
 *
 * Provides frame synchronization between Audio Worklet and Main Thread
 * using SharedArrayBuffer and Atomics for blocking wait.
 */

// Sync buffer layout (Int32Array indices)
const SYNC_STATE = 0;      // Frame state: 0=idle, 1=rendering, 2=complete
const SYNC_FRAME = 1;      // Current frame number
const SYNC_AUDIO_TIME = 2; // Audio time (low 32 bits)
const SYNC_AUDIO_TIME_HI = 3; // Audio time (high 32 bits)

// States
const STATE_IDLE = 0;
const STATE_RENDERING = 1;
const STATE_COMPLETE = 2;

/**
 * Create shared sync buffer
 * Call this on main thread and pass to worklet via processorOptions
 */
function createSyncBuffer() {
    // 16 bytes for sync state
    const sab = new SharedArrayBuffer(16);
    return new Int32Array(sab);
}

/**
 * Audio Worklet side: Wait for frame to complete
 * This blocks the audio thread until main thread signals frame complete
 */
function waitForFrameComplete(syncBuffer, timeoutMs = 100) {
    // Set state to rendering
    Atomics.store(syncBuffer, SYNC_STATE, STATE_RENDERING);

    // Wait for main thread to set state to complete
    const result = Atomics.wait(syncBuffer, SYNC_STATE, STATE_RENDERING, timeoutMs);

    // Reset state to idle
    Atomics.store(syncBuffer, SYNC_STATE, STATE_IDLE);

    return result !== 'timed-out';
}

/**
 * Main thread side: Signal frame complete
 * Call this after rendering the frame
 */
function signalFrameComplete(syncBuffer) {
    // Set state to complete
    Atomics.store(syncBuffer, SYNC_STATE, STATE_COMPLETE);

    // Wake up waiting audio thread
    Atomics.notify(syncBuffer, SYNC_STATE, 1);
}

/**
 * Main thread side: Check if audio is waiting for frame
 */
function isAudioWaiting(syncBuffer) {
    return Atomics.load(syncBuffer, SYNC_STATE) === STATE_RENDERING;
}

/**
 * Increment frame counter
 */
function incrementFrame(syncBuffer) {
    Atomics.add(syncBuffer, SYNC_FRAME, 1);
}

/**
 * Get current frame number
 */
function getFrameNumber(syncBuffer) {
    return Atomics.load(syncBuffer, SYNC_FRAME);
}

// Export for use in both contexts
if (typeof module !== 'undefined') {
    module.exports = {
        createSyncBuffer,
        waitForFrameComplete,
        signalFrameComplete,
        isAudioWaiting,
        incrementFrame,
        getFrameNumber,
        SYNC_STATE,
        SYNC_FRAME,
        STATE_IDLE,
        STATE_RENDERING,
        STATE_COMPLETE
    };
}
