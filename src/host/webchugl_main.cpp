/*----------------------------------------------------------------------------
  WebChuGL: ChuGL compiled to WebAssembly via Emscripten
  Entry point for the web build.

  Initializes ChucK VM, loads ChuGL module, compiles code/main.ck, and starts
  the graphics loop. Audio samples are passed to a JS AudioWorkletProcessor
  via SharedArrayBuffer ring buffers (see audio_ring_buffer.h and
  lib/audio-worklet-processor.js).

  Ring buffer format: Planar N-channel [ch0: RING_CAPACITY][ch1: RING_CAPACITY]...
  ChucK VM format: Planar [ch0_s0..ch0_sN, ch1_s0..ch1_sN, ...]
  Both use planar layout, so no format conversion is needed.
-----------------------------------------------------------------------------*/
#include "webchugl_internal.h"
#include "builtin_sensors.h"

#include "chuck.h"
#include "chuck_globals.h"
#include "chuck_errmsg.h"
#include "audio_ring_buffer.h"
#include "sg_command.h"
#include "core/log.h"

#include <GLFW/glfw3.h>
#include <emscripten.h>
#include <dlfcn.h>
#include <stdio.h>
#include <sys/stat.h>
#include <chrono>
#include <list>
#include <string>
#include <vector>

std::list<void*> g_chuginHandles;
std::list<std::string> g_loadedChuginPaths;

ChucK* the_chuck = nullptr;

// Audio defaults — overridden by Module._audioConfig (set from URL params / JS API).
static int g_sampleRate = 48000;
static int g_numOutputChannels = 2;
static int g_numInputChannels = 2;
static int g_maxSamplesPerCall = 4800;  // derived: g_sampleRate / 10 (100ms cap)

static std::chrono::high_resolution_clock::time_point g_lastAudioTime;

// The JS worklet reads/writes directly from WASM shared memory ring buffers
void initAudio()
{
    EM_ASM({
        if (typeof Module._initAudio === 'function') {
            Module._initAudio(
                Module.wasmMemory.buffer,  // SharedArrayBuffer
                $0, $1, $2,  // output: buffer ptr, writePos ptr, readPos ptr
                $3, $4, $5,  // input: buffer ptr, writePos ptr, readPos ptr
                $6,          // capacity
                $7,          // sampleRate
                $8,          // outChannels
                $9           // inChannels
            );
        } else {
            console.error('[WebChuGL] Module._initAudio not found');
        }
    },
    (uint32_t)(uintptr_t)g_audioRingBuffer,
    (uint32_t)(uintptr_t)&g_ringWritePos,
    (uint32_t)(uintptr_t)&g_ringReadPos,
    (uint32_t)(uintptr_t)g_inputRingBuffer,
    (uint32_t)(uintptr_t)&g_inputRingWritePos,
    (uint32_t)(uintptr_t)&g_inputRingReadPos,
    (uint32_t)RING_CAPACITY,
    g_sampleRate,
    g_numOutputChannels,
    g_numInputChannels);
}

static void run_vm_frame(void* data)
{
    ChucK* ck = (ChucK*)data;
    if (!ck) return;

    auto now = std::chrono::high_resolution_clock::now();
    double elapsedSeconds = std::chrono::duration<double>(now - g_lastAudioTime).count();
    int samplesToGenerate = (int)(elapsedSeconds * g_sampleRate + 0.5);
    g_lastAudioTime = now;

    if (samplesToGenerate > g_maxSamplesPerCall) {
        samplesToGenerate = g_maxSamplesPerCall;
    }

    if (samplesToGenerate >= 1) {
        int outCh = g_numOutputChannels;
        int inCh = g_numInputChannels;
        int maxSPC = g_maxSamplesPerCall;

        // Planar buffers for ChucK: [ch0_s0..ch0_sN, ch1_s0..ch1_sN, ...]
        // Ring buffers are also planar, so no format conversion needed.
        static SAMPLE* inBuffer = nullptr;
        static SAMPLE* outBuffer = nullptr;
        if (!inBuffer) {
            inBuffer = new SAMPLE[maxSPC * inCh]();
            outBuffer = new SAMPLE[maxSPC * outCh]();
        }

        // Read planar mic input directly from ring buffer into ChucK's buffer.
        // Zero first so unread slots are silent.
        memset(inBuffer, 0, samplesToGenerate * inCh * sizeof(SAMPLE));
        inputRingRead(inBuffer, samplesToGenerate, samplesToGenerate);

        ck->run(inBuffer, outBuffer, samplesToGenerate);

        uint32_t available = ringAvailableToWrite();
        if (available >= (uint32_t)samplesToGenerate) {
            ringWrite(outBuffer, samplesToGenerate, samplesToGenerate);
        }
    }
}

int main(int argc, char** argv)
{
    log_set_level(LOG_WARN);

    printf("[WebChuGL] Initializing...\n");

    g_sampleRate = EM_ASM_INT({
        var c = Module._audioConfig;
        return (c && c.sampleRate) ? c.sampleRate : 48000;
    });
    g_numOutputChannels = EM_ASM_INT({
        var c = Module._audioConfig;
        return (c && c.outChannels) ? c.outChannels : 2;
    });
    g_numInputChannels = EM_ASM_INT({
        var c = Module._audioConfig;
        return (c && c.inChannels) ? c.inChannels : 2;
    });
    if (g_sampleRate < 8000 || g_sampleRate > 192000) g_sampleRate = 48000;
    if (g_numOutputChannels < 1 || g_numOutputChannels > 32) g_numOutputChannels = 2;
    if (g_numInputChannels < 1 || g_numInputChannels > 32) g_numInputChannels = 2;
    g_maxSamplesPerCall = g_sampleRate / 10;  // 100ms cap

    printf("[WebChuGL] Audio config: %d Hz, %d out, %d in\n",
           g_sampleRate, g_numOutputChannels, g_numInputChannels);

    the_chuck = new ChucK();

    the_chuck->setParam(CHUCK_PARAM_SAMPLE_RATE, (t_CKINT)g_sampleRate);
    the_chuck->setParam(CHUCK_PARAM_INPUT_CHANNELS, (t_CKINT)g_numInputChannels);
    the_chuck->setParam(CHUCK_PARAM_OUTPUT_CHANNELS, (t_CKINT)g_numOutputChannels);
    the_chuck->setParam(CHUCK_PARAM_VM_HALT, (t_CKINT)0);
    the_chuck->setParam(CHUCK_PARAM_CHUGIN_ENABLE, (t_CKINT)1);

    std::list<std::string> packagesPaths;
    packagesPaths.push_back("/packages");
    the_chuck->setParam(CHUCK_PARAM_IMPORT_PATH_PACKAGES, packagesPaths);

    if (!the_chuck->init()) {
        printf("[WebChuGL] ERROR: Failed to initialize ChucK\n");
        return 1;
    }

    if (!the_chuck->compiler()->bind(ck_query, "ChuGL", "global")) {
        printf("[WebChuGL] ERROR: Failed to load ChuGL module\n");
        return 1;
    }

    // Before compileFile(): static init shreds check m_is_running.
    the_chuck->start();

    if (!the_chuck->compileCode(k_AccelMsg_ck, "", 1, TRUE) ||
        !the_chuck->compileCode(k_Accel_ck, "", 1, TRUE) ||
        !the_chuck->compileCode(k_GyroMsg_ck, "", 1, TRUE) ||
        !the_chuck->compileCode(k_Gyro_ck, "", 1, TRUE)) {
        printf("[WebChuGL] WARNING: Failed to compile built-in sensor classes\n");
    }

    g_lastAudioTime = std::chrono::high_resolution_clock::now();
    initRingBuffers(g_numOutputChannels, g_numInputChannels);
    initAudio();

    webchugl_set_pre_frame_callback(run_vm_frame, the_chuck);

    printf("[WebChuGL] Starting...\n");
    chugl_main_loop_hook(nullptr);

    return 0;
}

