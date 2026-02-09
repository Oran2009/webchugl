/*----------------------------------------------------------------------------
  WebChuGL: ChuGL compiled to WebAssembly via Emscripten
  Entry point for the web build.

  Initializes ChucK VM, loads ChuGL module, compiles code/main.ck, and starts
  the graphics loop. Audio samples are passed to a JS AudioWorkletProcessor
  via SharedArrayBuffer ring buffers (see audio_ring_buffer.h and
  audio-worklet-processor.js).

  Ring buffer format: Interleaved stereo [L0, R0, L1, R1, ...]
  ChucK VM format: Planar [L0, L1, ..., Ln, R0, R1, ..., Rn]
-----------------------------------------------------------------------------*/
#include "chuck.h"
#include "audio_ring_buffer.h"
#include "core/log.h"

#include <emscripten.h>
#include <dlfcn.h>
#include <stdio.h>
#include <chrono>
#include <list>
#include <string>

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

// Flag to track if microphone is needed (adc is used in the ChucK code)
static bool g_needsMicrophone = false;

// Initialize the audio system via JS AudioWorkletProcessor
// The JS worklet reads/writes directly from WASM shared memory ring buffers
void initAudio()
{
    EM_ASM({
        if (typeof window.initWebChuGLAudio === 'function') {
            window.initWebChuGLAudio(
                Module.wasmMemory.buffer,  // SharedArrayBuffer
                $0, $1, $2,  // output: buffer ptr, writePos ptr, readPos ptr
                $3, $4, $5,  // input: buffer ptr, writePos ptr, readPos ptr
                $6,          // capacity
                $7           // needsMic
            );
        } else {
            console.error('[WebChuGL] initWebChuGLAudio not found');
        }
    },
    (int)(uintptr_t)g_audioRingBuffer,
    (int)(uintptr_t)&g_ringWritePos,
    (int)(uintptr_t)&g_ringReadPos,
    (int)(uintptr_t)g_inputRingBuffer,
    (int)(uintptr_t)&g_inputRingWritePos,
    (int)(uintptr_t)&g_inputRingReadPos,
    (int)RING_CAPACITY,
    g_needsMicrophone ? 1 : 0);
}

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

        // Always run ChucK VM (needed for graphics via GG.nextFrame())
        ck->run(inBuffer, outBuffer, samplesToGenerate);

        // Write to ring buffer if there's space (drop audio if full)
        uint32_t available = ringAvailableToWrite();
        if (available >= (uint32_t)samplesToGenerate) {
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
    the_chuck->setParam(CHUCK_PARAM_CHUGIN_ENABLE, (t_CKINT)1);
    the_chuck->setParam(CHUCK_PARAM_WORKING_DIRECTORY, "/code");

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

    // Load ChuGins via dlopen() (paths scanned by JS ChuginLoader during preRun)
    {
        int chuginCount = EM_ASM_INT({
            return window.ChuginLoader ? window.ChuginLoader.getPendingCount() : 0;
        });

        if (chuginCount > 0) {
            printf("[WebChuGL] Loading %d ChuGin(s) via dlopen...\n", chuginCount);

            for (int i = 0; i < chuginCount; i++) {
                // Get the filesystem path from JS
                char* path = (char*)EM_ASM_PTR({
                    var paths = window.ChuginLoader.pendingChugins;
                    var p = paths[$0];
                    var len = lengthBytesUTF8(p) + 1;
                    var ptr = _malloc(len);
                    stringToUTF8(p, ptr, len);
                    return ptr;
                }, i);

                // Extract name from path (e.g. "/code/Bitcrusher.chug.wasm" -> "Bitcrusher")
                std::string pathStr(path);
                std::string name = pathStr.substr(pathStr.rfind('/') + 1);
                size_t dotPos = name.find(".chug");
                if (dotPos != std::string::npos) name = name.substr(0, dotPos);

                // Load the SIDE_MODULE via Emscripten's dlopen
                void* handle = dlopen(path, RTLD_NOW);
                if (!handle) {
                    printf("[WebChuGL] ERROR: dlopen failed for %s: %s\n", path, dlerror());
                    free(path);
                    continue;
                }

                // Get ck_query function pointer
                f_ck_query queryFunc = (f_ck_query)dlsym(handle, "ck_query");
                if (!queryFunc) {
                    printf("[WebChuGL] ERROR: dlsym(ck_query) failed for %s: %s\n",
                           path, dlerror());
                    dlclose(handle);
                    free(path);
                    continue;
                }

                // Register with ChucK compiler
                if (the_chuck->compiler()->bind(queryFunc, name.c_str(), "global")) {
                    printf("[WebChuGL] Loaded ChuGin: %s\n", name.c_str());
                } else {
                    printf("[WebChuGL] ERROR: Failed to bind ChuGin: %s\n", name.c_str());
                    dlclose(handle);
                }

                free(path);
            }

            // Clear pending list
            EM_ASM({ window.ChuginLoader.pendingChugins = []; });
        }
    }

    // IMPORTANT: start() must be called BEFORE compileFile() so that
    // static initialization shreds can execute properly (they check m_is_running)
    the_chuck->start();

    if (!the_chuck->compileFile("/code/main.ck", "", 1, TRUE)) {
        printf("[WebChuGL] ERROR: Failed to compile /code/main.ck\n");
        return 1;
    }

    // Run VM briefly to execute initial setup code before GG.nextFrame()
    {
        static SAMPLE initBuffer[256 * NUM_CHANNELS];
        the_chuck->run(nullptr, initBuffer, 256);
    }

    // Check if adc is used (has downstream connections)
    // Only request microphone permission if the ChucK code actually uses adc
    Chuck_UGen* adc = the_chuck->vm()->m_adc;
    if (adc && adc->m_num_dest > 0) {
        g_needsMicrophone = true;
        printf("[WebChuGL] ADC in use - microphone will be requested\n");
    }

    g_lastAudioTime = std::chrono::high_resolution_clock::now();
    initAudio();

    webchugl_set_pre_frame_callback(run_vm_frame, the_chuck);

    printf("[WebChuGL] Starting...\n");
    chugl_main_loop_hook(nullptr);

    return 0;
}
