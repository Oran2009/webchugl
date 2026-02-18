/*----------------------------------------------------------------------------
  WebChuGL Audio Ring Buffer
  Lock-free single-producer single-consumer ring buffers for passing audio
  samples between main thread and Audio Worklet.

  OUTPUT ring buffer: Main thread (producer) -> Audio Worklet (consumer)
  INPUT ring buffer:  Audio Worklet (producer) -> Main thread (consumer)

  Uses atomic read/write positions. Global variables are automatically shared
  between main thread and Audio Worklet via Emscripten's SharedArrayBuffer.

  Buffer format: Interleaved N-channel [ch0_s0, ch1_s0, ..., chN_s0, ch0_s1, ...]
  Call initRingBuffers(outChannels, inChannels) before use.
-----------------------------------------------------------------------------*/
#pragma once

#include <atomic>
#include <cstdint>

// Ring buffer capacity in samples (not bytes)
// ~170ms at 48kHz, large enough for variable FPS jitter
static const uint32_t RING_CAPACITY = 8192;

// Channel counts (set by initRingBuffers)
static uint32_t g_outChannels = 2;
static uint32_t g_inChannels = 2;

// ============================================================================
// OUTPUT Ring Buffer (Main thread -> Audio Worklet)
// ============================================================================

static float* g_audioRingBuffer = nullptr;
static std::atomic<uint32_t> g_ringWritePos{0};
static std::atomic<uint32_t> g_ringReadPos{0};

// ============================================================================
// INPUT Ring Buffer (Audio Worklet -> Main thread) for microphone
// ============================================================================

static float* g_inputRingBuffer = nullptr;
static std::atomic<uint32_t> g_inputRingWritePos{0};
static std::atomic<uint32_t> g_inputRingReadPos{0};

// ============================================================================
// Initialization
// ============================================================================

// Allocate ring buffers. Must be called once before any read/write operations.
inline void initRingBuffers(uint32_t outChannels, uint32_t inChannels) {
    g_outChannels = outChannels;
    g_inChannels = inChannels;
    g_audioRingBuffer = new float[RING_CAPACITY * outChannels]();
    g_inputRingBuffer = new float[RING_CAPACITY * inChannels]();
}

// ============================================================================
// OUTPUT Ring Buffer Operations
// ============================================================================

inline uint32_t ringAvailableToWrite() {
    uint32_t writePos = g_ringWritePos.load(std::memory_order_relaxed);
    uint32_t readPos = g_ringReadPos.load(std::memory_order_acquire);
    return RING_CAPACITY - (writePos - readPos);
}

// Write interleaved samples to output ring buffer
// data: interleaved samples, length = samples * g_outChannels
inline void ringWrite(const float* data, int samples) {
    uint32_t writePos = g_ringWritePos.load(std::memory_order_relaxed);
    uint32_t nc = g_outChannels;

    for (int i = 0; i < samples; i++) {
        uint32_t idx = ((writePos + i) % RING_CAPACITY) * nc;
        uint32_t srcIdx = i * nc;
        for (uint32_t ch = 0; ch < nc; ch++) {
            g_audioRingBuffer[idx + ch] = data[srcIdx + ch];
        }
    }

    g_ringWritePos.store(writePos + samples, std::memory_order_release);
}

// ============================================================================
// INPUT Ring Buffer Operations
// ============================================================================

inline uint32_t inputRingAvailableToRead() {
    uint32_t writePos = g_inputRingWritePos.load(std::memory_order_acquire);
    uint32_t readPos = g_inputRingReadPos.load(std::memory_order_relaxed);
    return writePos - readPos;
}

// Read from input ring buffer, converting interleaved → planar for ChucK
// outBuffer: planar [ch0_s0..ch0_sN, ch1_s0..ch1_sN, ...]
// Returns: total floats written (samplesRead * g_inChannels)
inline int inputRingRead(float* outBuffer, int samples) {
    uint32_t available = inputRingAvailableToRead();
    if (available == 0) return 0;
    if ((uint32_t)samples > available) samples = available;

    uint32_t readPos = g_inputRingReadPos.load(std::memory_order_relaxed);
    uint32_t nc = g_inChannels;

    for (int i = 0; i < samples; i++) {
        uint32_t idx = ((readPos + i) % RING_CAPACITY) * nc;
        for (uint32_t ch = 0; ch < nc; ch++) {
            outBuffer[ch * samples + i] = g_inputRingBuffer[idx + ch];
        }
    }

    g_inputRingReadPos.store(readPos + samples, std::memory_order_release);
    return samples * nc;
}
