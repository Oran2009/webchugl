/*----------------------------------------------------------------------------
  WebChuGL Audio Ring Buffer
  Lock-free single-producer single-consumer ring buffers for passing audio
  samples between main thread and Audio Worklet.

  OUTPUT ring buffer: Main thread (producer) -> Audio Worklet (consumer)
  INPUT ring buffer:  Audio Worklet (producer) -> Main thread (consumer)

  Uses atomic read/write positions. Global variables are automatically shared
  between main thread and Audio Worklet via Emscripten's SharedArrayBuffer.

  Buffer format: Interleaved stereo [L0, R0, L1, R1, ...]
-----------------------------------------------------------------------------*/
#pragma once

#include <atomic>
#include <cstdint>

// Ring buffer capacity in samples (not bytes)
// ~170ms at 48kHz, large enough for variable FPS jitter
static const uint32_t RING_CAPACITY = 8192;

// ============================================================================
// OUTPUT Ring Buffer (Main thread -> Audio Worklet)
// ============================================================================

// Ring buffer storage (stereo interleaved: L0,R0,L1,R1,...)
static float g_audioRingBuffer[RING_CAPACITY * 2];

// Read/write positions (in samples, not bytes)
static std::atomic<uint32_t> g_ringWritePos{0};
static std::atomic<uint32_t> g_ringReadPos{0};

// Returns number of samples available to write
inline uint32_t ringAvailableToWrite() {
    uint32_t writePos = g_ringWritePos.load(std::memory_order_relaxed);
    uint32_t readPos = g_ringReadPos.load(std::memory_order_acquire);
    return RING_CAPACITY - (writePos - readPos);
}

// Write interleaved stereo samples to ring buffer
// data: array of interleaved samples [L0,R0,L1,R1,...] of length samples*2
// samples: number of stereo sample pairs to write
inline void ringWrite(const float* data, int samples) {
    uint32_t writePos = g_ringWritePos.load(std::memory_order_relaxed);

    for (int i = 0; i < samples; i++) {
        uint32_t idx = ((writePos + i) % RING_CAPACITY) * 2;
        g_audioRingBuffer[idx] = data[i * 2];       // Left
        g_audioRingBuffer[idx + 1] = data[i * 2 + 1]; // Right
    }

    g_ringWritePos.store(writePos + samples, std::memory_order_release);
}

// ============================================================================
// INPUT Ring Buffer (Audio Worklet -> Main thread) for microphone
// ============================================================================

// Input ring buffer storage (stereo interleaved)
static float g_inputRingBuffer[RING_CAPACITY * 2];

// Read/write positions for input
static std::atomic<uint32_t> g_inputRingWritePos{0};
static std::atomic<uint32_t> g_inputRingReadPos{0};

// Returns number of input samples available to read
inline uint32_t inputRingAvailableToRead() {
    uint32_t writePos = g_inputRingWritePos.load(std::memory_order_acquire);
    uint32_t readPos = g_inputRingReadPos.load(std::memory_order_relaxed);
    return writePos - readPos;
}

// Read planar stereo samples from input ring buffer for ChucK
// outBuffer: planar format [L0,L1,...,Ln,R0,R1,...,Rn]
// samples: number of samples per channel to read
// Returns: total number of SAMPLE values written (samples * 2 if successful)
inline int inputRingRead(float* outBuffer, int samples) {
    uint32_t available = inputRingAvailableToRead();
    if (available == 0) {
        return 0;
    }

    if ((uint32_t)samples > available) {
        samples = available;
    }

    uint32_t readPos = g_inputRingReadPos.load(std::memory_order_relaxed);

    // Convert from interleaved [L0,R0,L1,R1,...] to planar [L0..Ln, R0..Rn]
    for (int i = 0; i < samples; i++) {
        uint32_t idx = ((readPos + i) % RING_CAPACITY) * 2;
        outBuffer[i] = g_inputRingBuffer[idx];           // Left channel
        outBuffer[samples + i] = g_inputRingBuffer[idx + 1]; // Right channel
    }

    g_inputRingReadPos.store(readPos + samples, std::memory_order_release);
    return samples * 2;  // Return total SAMPLE values written
}
