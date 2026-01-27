/*----------------------------------------------------------------------------
  WebChuGL: ChuGL compiled to WebAssembly via Emscripten
  Entry point for the web build.

  Initializes ChucK VM, loads ChuGL module, compiles code/main.ck, and starts
  the graphics loop. Audio samples are passed to Audio Worklet via ring buffer.
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

// Audio timing
static std::chrono::high_resolution_clock::time_point g_lastAudioTime;
static const double SAMPLE_RATE = 48000.0;
static const int MAX_SAMPLES_PER_CALL = 4800; // 100ms max to prevent spikes

// Audio worklet state
static EMSCRIPTEN_WEBAUDIO_T g_audioContext = 0;
static uint8_t g_wasmAudioWorkletStack[4096];

// Audio worklet callback - runs on audio thread
// Reads 128 samples from ring buffer and writes to output
EM_BOOL ProcessAudio(int numInputs, const AudioSampleFrame* inputs,
                     int numOutputs, AudioSampleFrame* outputs,
                     int numParams, const AudioParamFrame* params, void* userData)
{
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

    int outputChannelCounts[1] = { 2 };
    EmscriptenAudioWorkletNodeCreateOptions opts = {
        .numberOfInputs = 0,
        .numberOfOutputs = 1,
        .outputChannelCounts = outputChannelCounts
    };

    EMSCRIPTEN_AUDIO_WORKLET_NODE_T node =
        emscripten_create_wasm_audio_worklet_node(ctx, "chugl-audio", &opts, &ProcessAudio, nullptr);

    // Connect node to destination and set up click-to-resume
    EM_ASM({
        let ctx = emscriptenGetAudioObject($0);
        let node = emscriptenGetAudioObject($1);
        node.connect(ctx.destination);

        let startAudio = function() {
            if (ctx.state !== 'running') {
                ctx.resume();
            }
        };
        document.addEventListener('click', startAudio, { once: true });
        document.addEventListener('keydown', startAudio, { once: true });
    }, ctx, node);
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

// Pre-fill the audio buffer with samples to prevent initial underrun
static void prefillAudioBuffer(ChucK* ck, int samples)
{
    static SAMPLE outBuffer[MAX_SAMPLES_PER_CALL];
    static float floatBuffer[MAX_SAMPLES_PER_CALL * 2];

    int remaining = samples;
    while (remaining > 0) {
        int chunk = (remaining > MAX_SAMPLES_PER_CALL) ? MAX_SAMPLES_PER_CALL : remaining;
        ck->run(nullptr, outBuffer, chunk);

        for (int i = 0; i < chunk; i++) {
            float sample = (float)outBuffer[i];
            floatBuffer[i * 2] = sample;
            floatBuffer[i * 2 + 1] = sample;
        }
        ringWrite(floatBuffer, chunk);
        remaining -= chunk;
    }
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
            static SAMPLE outBuffer[MAX_SAMPLES_PER_CALL];
            ck->run(nullptr, outBuffer, samplesToGenerate);

            static float floatBuffer[MAX_SAMPLES_PER_CALL * 2];
            for (int i = 0; i < samplesToGenerate; i++) {
                float sample = (float)outBuffer[i];
                floatBuffer[i * 2] = sample;
                floatBuffer[i * 2 + 1] = sample;
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
    the_chuck->setParam(CHUCK_PARAM_INPUT_CHANNELS, (t_CKINT)0);
    the_chuck->setParam(CHUCK_PARAM_OUTPUT_CHANNELS, (t_CKINT)1);
    the_chuck->setParam(CHUCK_PARAM_VM_HALT, (t_CKINT)0);
    the_chuck->setParam(CHUCK_PARAM_CHUGIN_ENABLE, (t_CKINT)0);

    if (!the_chuck->init()) {
        printf("[WebChuGL] ERROR: Failed to initialize ChucK\n");
        return 1;
    }

    if (!the_chuck->compiler()->bind(ck_query, "ChuGL", "global")) {
        printf("[WebChuGL] ERROR: Failed to load ChuGL module\n");
        return 1;
    }

    if (!the_chuck->compileFile("/main.ck", "", 1, TRUE)) {
        printf("[WebChuGL] ERROR: Failed to compile /main.ck\n");
        return 1;
    }

    the_chuck->start();

    // Run VM briefly to execute initial setup code before GG.nextFrame()
    {
        static SAMPLE initBuffer[256];
        the_chuck->run(nullptr, initBuffer, 256);
    }

    g_lastAudioTime = std::chrono::high_resolution_clock::now();
    prefillAudioBuffer(the_chuck, 4800);
    initAudio();

    webchugl_set_pre_frame_callback(run_vm_frame, the_chuck);

    printf("[WebChuGL] Starting...\n");
    chugl_main_loop_hook(nullptr);

    return 0;
}
