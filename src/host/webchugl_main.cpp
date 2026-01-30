/*----------------------------------------------------------------------------
  WebChuGL: ChuGL compiled to WebAssembly via Emscripten
  Entry point for the web build.

  Initializes ChucK VM, loads ChuGL module, compiles code/main.ck, and starts
  the graphics loop. Audio samples are passed to Audio Worklet via ring buffer.

  Audio buffer format: PLANAR (left channel first, then right channel)
  - Output: [L0, L1, ..., Ln, R0, R1, ..., Rn]
  - Input:  [L0, L1, ..., Ln, R0, R1, ..., Rn]
-----------------------------------------------------------------------------*/
#include "chuck.h"
#include "audio_ring_buffer.h"
#include "core/log.h"

#include <emscripten.h>
#include <emscripten/webaudio.h>
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

// Audio worklet state
static EMSCRIPTEN_WEBAUDIO_T g_audioContext = 0;
static uint8_t g_wasmAudioWorkletStack[4096];

// Flag to track if microphone is needed (adc is used in the ChucK code)
static bool g_needsMicrophone = false;

// Audio worklet callback - runs on audio thread
// Reads 128 samples from ring buffer and writes to output
EM_BOOL ProcessAudio(int numInputs, const AudioSampleFrame* inputs,
                     int numOutputs, AudioSampleFrame* outputs,
                     int numParams, const AudioParamFrame* params, void* userData)
{
    // Write mic input to input ring buffer (if available)
    if (numInputs > 0 && inputs[0].numberOfChannels >= 2) {
        // Input is planar: first 128 samples are left, next 128 are right
        inputRingWrite(inputs[0].data, 128);
    }

    // Read output from ring buffer
    for (int i = 0; i < 128; i++) {
        float left, right;
        if (ringRead(&left, &right)) {
            outputs[0].data[i] = left;
            outputs[0].data[128 + i] = right;
        } else {
            outputs[0].data[i] = 0.0f;
            outputs[0].data[128 + i] = 0.0f;
        }
    }
    return EM_TRUE;
}

// Callback when AudioWorkletProcessor is created
void AudioWorkletProcessorCreated(EMSCRIPTEN_WEBAUDIO_T ctx, EM_BOOL success, void* userData)
{
    if (!success) {
        printf("[WebChuGL] ERROR: Failed to create AudioWorkletProcessor\n");
        return;
    }

    int outputChannelCounts[1] = { NUM_CHANNELS };
    EmscriptenAudioWorkletNodeCreateOptions opts = {
        .numberOfInputs = 1,  // Enable mic input
        .numberOfOutputs = 1,
        .outputChannelCounts = outputChannelCounts
    };

    EMSCRIPTEN_AUDIO_WORKLET_NODE_T node =
        emscripten_create_wasm_audio_worklet_node(ctx, "chugl-audio", &opts, &ProcessAudio, nullptr);

    // Connect node to destination and optionally set up mic input
    EM_ASM({
        let ctx = emscriptenGetAudioObject($0);
        let node = emscriptenGetAudioObject($1);
        let needsMic = $2;
        node.connect(ctx.destination);

        // Only request microphone if adc is used in the ChucK code
        if (needsMic) {
            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(function(stream) {
                    let source = ctx.createMediaStreamSource(stream);
                    source.connect(node);
                    console.log('[WebChuGL] Microphone connected');
                })
                .catch(function(err) {
                    console.log('[WebChuGL] Microphone not available: ' + err.message);
                });
        }

        let startAudio = function() {
            if (ctx.state !== 'running') {
                ctx.resume();
            }
        };
        document.addEventListener('click', startAudio, { once: true });
        document.addEventListener('keydown', startAudio, { once: true });
    }, ctx, node, g_needsMicrophone ? 1 : 0);
}

// Callback when Audio Worklet thread is initialized
void WebAudioWorkletThreadInitialized(EMSCRIPTEN_WEBAUDIO_T ctx, EM_BOOL success, void* userData)
{
    if (!success) {
        printf("[WebChuGL] ERROR: Failed to initialize Audio Worklet thread\n");
        return;
    }

    WebAudioWorkletProcessorCreateOptions opts = { .name = "chugl-audio" };
    emscripten_create_wasm_audio_worklet_processor_async(ctx, &opts, AudioWorkletProcessorCreated, nullptr);
}

// Initialize the audio system
void initAudio()
{
    EmscriptenWebAudioCreateAttributes attrs = {
        .latencyHint = "interactive",
        .sampleRate = 48000
    };
    g_audioContext = emscripten_create_audio_context(&attrs);

    if (g_audioContext == 0) {
        printf("[WebChuGL] ERROR: Failed to create audio context\n");
        return;
    }

    emscripten_start_wasm_audio_worklet_thread_async(
        g_audioContext,
        g_wasmAudioWorkletStack,
        sizeof(g_wasmAudioWorkletStack),
        WebAudioWorkletThreadInitialized,
        nullptr
    );
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
    the_chuck->setParam(CHUCK_PARAM_CHUGIN_ENABLE, (t_CKINT)1);
    the_chuck->setParam(CHUCK_PARAM_WORKING_DIRECTORY, "/code");

    if (!the_chuck->init()) {
        printf("[WebChuGL] ERROR: Failed to initialize ChucK\n");
        return 1;
    }

    if (!the_chuck->compiler()->bind(ck_query, "ChuGL", "global")) {
        printf("[WebChuGL] ERROR: Failed to load ChuGL module\n");
        return 1;
    }

    // Load ChuGins from JavaScript (scanned from filesystem during preRun)
    {
        // Get the number of pending ChuGins
        int chuginCount = EM_ASM_INT({
            return window.ChuginLoader ? window.ChuginLoader.getPendingCount() : 0;
        });

        if (chuginCount > 0) {
            printf("[WebChuGL] Loading %d ChuGin(s)...\n", chuginCount);

            // Load all ChuGins and get their function table indices
            // This calls ChuginLoader.loadAllPending() which instantiates the SIDE_MODULEs
            EM_ASM({
                var chugins = window.ChuginLoader.loadAllPending();
                // Store results in a global array for C++ to access
                window._loadedChugins = chugins;
            });

            // Now register each ChuGin with ChucK
            int loadedCount = EM_ASM_INT({
                return window._loadedChugins ? window._loadedChugins.length : 0;
            });

            for (int i = 0; i < loadedCount; i++) {
                // Get name and function index for this ChuGin
                char* name = (char*)EM_ASM_PTR({
                    var chugin = window._loadedChugins[$0];
                    var name = chugin.name;
                    var len = lengthBytesUTF8(name) + 1;
                    var ptr = _malloc(len);
                    stringToUTF8(name, ptr, len);
                    return ptr;
                }, i);

                int funcIndex = EM_ASM_INT({
                    return window._loadedChugins[$0].funcIndex;
                }, i);

                // Convert function table index to function pointer
                // In Emscripten, indirect function calls go through the table
                f_ck_query queryFunc = (f_ck_query)funcIndex;

                // Register with ChucK compiler
                if (the_chuck->compiler()->bind(queryFunc, name, "global")) {
                    printf("[WebChuGL] Loaded ChuGin: %s\n", name);
                } else {
                    printf("[WebChuGL] ERROR: Failed to load ChuGin: %s\n", name);
                }

                free(name);
            }

            // Clean up
            EM_ASM({ window._loadedChugins = null; });
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
