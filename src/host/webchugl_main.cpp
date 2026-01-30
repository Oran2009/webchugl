/*----------------------------------------------------------------------------
  WebChuGL: ChuGL compiled to WebAssembly via Emscripten
  Entry point for the web build.

  Initializes ChucK VM, loads ChuGL module, compiles code/main.ck, and starts
  the graphics loop. Audio samples are passed to JS Audio Worklet via ring buffer
  backed by SharedArrayBuffer.

  Audio buffer format: PLANAR (left channel first, then right channel)
  - Output: [L0, L1, ..., Ln, R0, R1, ..., Rn]
  - Input:  [L0, L1, ..., Ln, R0, R1, ..., Rn]
-----------------------------------------------------------------------------*/
#include "chuck.h"
#include "audio_ring_buffer.h"
#include "core/log.h"

#include <emscripten.h>
#include <stdio.h>
#include <chrono>

// ChuGL query function (defined via CK_DLL_QUERY macro in ChuGL.cpp)
extern "C" t_CKBOOL ck_query(Chuck_DL_Query* QUERY);

// ChuGL main loop hook (defined in ChuGL.cpp)
extern t_CKBOOL chugl_main_loop_hook(void* bindle);

// Pre-frame callback registration (defined in app.cpp under __EMSCRIPTEN__)
extern "C" void webchugl_set_pre_frame_callback(void (*fn)(void*), void* data);

// The ChucK instance
static ChucK* the_chuck = nullptr;

// Audio configuration
static const int NUM_CHANNELS = 2;  // Stereo
static const double SAMPLE_RATE = 48000.0;
static const int MAX_SAMPLES_PER_CALL = 4800; // 100ms max to prevent spikes

// Audio timing
static std::chrono::high_resolution_clock::time_point g_lastAudioTime;

// ============================================================================
// Exported functions for JavaScript audio worklet
// These allow JS to access the ring buffer via SharedArrayBuffer
// ============================================================================

extern "C" {

// Get pointer to output ring buffer (main thread writes, audio worklet reads)
EMSCRIPTEN_KEEPALIVE
float* getOutputRingBuffer() {
    return g_audioRingBuffer;
}

// Get pointer to output ring write position
EMSCRIPTEN_KEEPALIVE
uint32_t* getOutputRingWritePos() {
    return reinterpret_cast<uint32_t*>(&g_ringWritePos);
}

// Get pointer to output ring read position
EMSCRIPTEN_KEEPALIVE
uint32_t* getOutputRingReadPos() {
    return reinterpret_cast<uint32_t*>(&g_ringReadPos);
}

// Get pointer to input ring buffer (audio worklet writes, main thread reads)
EMSCRIPTEN_KEEPALIVE
float* getInputRingBuffer() {
    return g_inputRingBuffer;
}

// Get pointer to input ring write position
EMSCRIPTEN_KEEPALIVE
uint32_t* getInputRingWritePos() {
    return reinterpret_cast<uint32_t*>(&g_inputRingWritePos);
}

// Get pointer to input ring read position
EMSCRIPTEN_KEEPALIVE
uint32_t* getInputRingReadPos() {
    return reinterpret_cast<uint32_t*>(&g_inputRingReadPos);
}

// Get ring buffer capacity
EMSCRIPTEN_KEEPALIVE
uint32_t getRingCapacity() {
    return RING_CAPACITY;
}

}  // extern "C"

// Pre-frame callback: advances the ChucK VM based on elapsed time
static void run_vm_frame(void* data)
{
    ChucK* ck = (ChucK*)data;
    if (!ck) return;

    auto now = std::chrono::high_resolution_clock::now();
    double elapsedSeconds = std::chrono::duration<double>(now - g_lastAudioTime).count();
    int samplesToGenerate = (int)(elapsedSeconds * SAMPLE_RATE + 0.5);
    g_lastAudioTime = now;

    if (samplesToGenerate > MAX_SAMPLES_PER_CALL) {
        samplesToGenerate = MAX_SAMPLES_PER_CALL;
    }

    if (samplesToGenerate >= 1) {
        uint32_t available = ringAvailableToWrite();
        if (available >= (uint32_t)samplesToGenerate) {
            // Planar buffers: [L0..Ln, R0..Rn]
            static SAMPLE inBuffer[MAX_SAMPLES_PER_CALL * NUM_CHANNELS];
            static SAMPLE outBuffer[MAX_SAMPLES_PER_CALL * NUM_CHANNELS];
            static float floatBuffer[MAX_SAMPLES_PER_CALL * 2];
            static float floatInBuffer[MAX_SAMPLES_PER_CALL * NUM_CHANNELS];

            // Read mic input from input ring buffer (planar format)
            int inputSamples = inputRingRead(floatInBuffer, samplesToGenerate);
            // Convert float to SAMPLE and zero-fill if not enough
            for (int i = 0; i < samplesToGenerate * NUM_CHANNELS; i++) {
                inBuffer[i] = (i < inputSamples) ? (SAMPLE)floatInBuffer[i] : 0;
            }

            // Run ChucK VM with input and output
            ck->run(inBuffer, outBuffer, samplesToGenerate);

            // Convert from planar SAMPLE to interleaved float for ring buffer
            for (int i = 0; i < samplesToGenerate; i++) {
                floatBuffer[i * 2] = (float)outBuffer[i];                      // Left
                floatBuffer[i * 2 + 1] = (float)outBuffer[samplesToGenerate + i]; // Right
            }
            ringWrite(floatBuffer, samplesToGenerate);
        }
    }
}

int main(int argc, char** argv)
{
    // Suppress ChuGL debug/trace messages, only show warnings and errors
    log_set_level(LOG_WARN);

    printf("[WebChuGL] Initializing...\n");

    the_chuck = new ChucK();

    the_chuck->setParam(CHUCK_PARAM_SAMPLE_RATE, (t_CKINT)48000);
    the_chuck->setParam(CHUCK_PARAM_INPUT_CHANNELS, (t_CKINT)NUM_CHANNELS);
    the_chuck->setParam(CHUCK_PARAM_OUTPUT_CHANNELS, (t_CKINT)NUM_CHANNELS);
    the_chuck->setParam(CHUCK_PARAM_VM_HALT, (t_CKINT)0);
    the_chuck->setParam(CHUCK_PARAM_CHUGIN_ENABLE, (t_CKINT)0);
    the_chuck->setParam(CHUCK_PARAM_WORKING_DIRECTORY, "/");

    if (!the_chuck->init()) {
        printf("[WebChuGL] ERROR: Failed to initialize ChucK\n");
        return 1;
    }

    if (!the_chuck->compiler()->bind(ck_query, "ChuGL", "global")) {
        printf("[WebChuGL] ERROR: Failed to load ChuGL module\n");
        return 1;
    }

    if (!the_chuck->compileFile("/code/main.ck", "", 1, TRUE)) {
        printf("[WebChuGL] ERROR: Failed to compile /code/main.ck\n");
        return 1;
    }

    the_chuck->start();

    // Run VM briefly to execute initial setup code before GG.nextFrame()
    {
        static SAMPLE initBuffer[256 * NUM_CHANNELS];
        the_chuck->run(nullptr, initBuffer, 256);
    }

    g_lastAudioTime = std::chrono::high_resolution_clock::now();

    // Audio is initialized from JavaScript via webchugl.js
    // JS will call the exported ring buffer functions to set up SharedArrayBuffer access

    webchugl_set_pre_frame_callback(run_vm_frame, the_chuck);

    printf("[WebChuGL] Starting...\n");
    chugl_main_loop_hook(nullptr);

    return 0;
}
