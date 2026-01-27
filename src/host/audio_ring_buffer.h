/*----------------------------------------------------------------------------
  WebChuGL Audio Ring Buffer
  Lock-free single-producer single-consumer ring buffer for passing audio
  samples from main thread to Audio Worklet.

  Uses atomic read/write positions. Global variables are automatically shared
  between main thread and Audio Worklet via Emscripten's SharedArrayBuffer.
-----------------------------------------------------------------------------*/
#pragma once

#include <atomic>
#include <cstdint>

// Ring buffer capacity in samples (not bytes)
// ~170ms at 48kHz, large enough for variable FPS jitter
static const uint32_t RING_CAPACITY = 8192;

// Ring buffer storage (stereo interleaved: L0,R0,L1,R1,...)
// Shared between main thread and audio worklet via SharedArrayBuffer
static float g_audioRingBuffer[RING_CAPACITY * 2];

// Read/write positions (in samples, not bytes)
// These wrap around using modulo arithmetic
static std::atomic<uint32_t> g_ringWritePos{0};
static std::atomic<uint32_t> g_ringReadPos{0};

// Returns number of samples available to write
inline uint32_t ringAvailableToWrite() {
    uint32_t writePos = g_ringWritePos.load(std::memory_order_relaxed);
    uint32_t readPos = g_ringReadPos.load(std::memory_order_acquire);
    return RING_CAPACITY - (writePos - readPos);
}

// Returns number of samples available to read
inline uint32_t ringAvailableToRead() {
    uint32_t writePos = g_ringWritePos.load(std::memory_order_acquire);
    uint32_t readPos = g_ringReadPos.load(std::memory_order_relaxed);
    return writePos - readPos;
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

// Read one stereo sample from ring buffer
// Returns true if sample was read, false if buffer empty
inline bool ringRead(float* left, float* right) {
    if (ringAvailableToRead() == 0) {
        return false;
    }

    uint32_t readPos = g_ringReadPos.load(std::memory_order_relaxed);
    uint32_t idx = (readPos % RING_CAPACITY) * 2;

    *left = g_audioRingBuffer[idx];
    *right = g_audioRingBuffer[idx + 1];

    g_ringReadPos.store(readPos + 1, std::memory_order_release);
    return true;
}
