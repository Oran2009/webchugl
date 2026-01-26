/*----------------------------------------------------------------------------
  WebChuGL: ChuGL compiled to WebAssembly via Emscripten
  Entry point for the web build.

  Supports two modes:
  1. Standard mode: Initializes ChucK VM, loads ChuGL, compiles program.ck
  2. Renderer-only mode: Just runs the renderer, receives commands from JavaScript
     (for Audio Worklet architecture where ChucK runs in worklet thread)
-----------------------------------------------------------------------------*/
#include "chuck.h"

#include <emscripten.h>
#include <stdio.h>
#include <string.h>

// ChuGL query function (defined via CK_DLL_QUERY macro in ChuGL.cpp)
extern "C" t_CKBOOL ck_query(Chuck_DL_Query* QUERY);

// ChuGL main loop hook (defined in ChuGL.cpp)
// Calls App::init() + App::start() which sets up GLFW, WebGPU, and the
// emscripten main loop via requestAnimationFrame.
extern t_CKBOOL chugl_main_loop_hook(void* bindle);

// Pre-frame callback registration (defined in app.cpp under __EMSCRIPTEN__)
// Called each frame before rendering to advance the ChucK VM.
extern "C" void webchugl_set_pre_frame_callback(void (*fn)(void*), void* data);

// Command queue initialization (from sg_command.cpp)
extern void CQ_Init();

// Sokol time initialization (from sokol_time.h via implementations.cpp)
extern "C" void stm_setup();

// The ChucK instance (null in renderer-only mode)
static ChucK* the_chuck = nullptr;

// Samples per frame: 48000 Hz / 60 FPS = 800 samples
static const int SAMPLES_PER_FRAME = 800;

// Mode flag (non-static for external access from app.cpp)
bool renderer_only_mode = false;

// Pre-frame callback: advances the ChucK VM each frame (standard mode only)
static void run_vm_frame(void* data)
{
    if (renderer_only_mode) return;

    ChucK* ck = (ChucK*)data;
    if (ck) {
        static SAMPLE outBuffer[SAMPLES_PER_FRAME * 2]; // stereo
        ck->run(nullptr, outBuffer, SAMPLES_PER_FRAME);
    }
}

// Check for renderer-only mode flag
static bool check_renderer_only_mode()
{
    // Check for URL parameter or environment variable
    // For now, check if program.ck exists
    FILE* f = fopen("/program.ck", "r");
    if (f) {
        fclose(f);
        return false; // program.ck exists, run in standard mode
    }
    return true; // No program.ck, run in renderer-only mode
}

extern "C" {

// Export to allow JavaScript to set renderer-only mode
EMSCRIPTEN_KEEPALIVE
void webchugl_set_renderer_only(int enabled)
{
    renderer_only_mode = enabled != 0;
    printf("[WebChuGL] Renderer-only mode: %s\n", renderer_only_mode ? "enabled" : "disabled");
}

// Export to start the renderer (for renderer-only mode)
EMSCRIPTEN_KEEPALIVE
void webchugl_start_renderer()
{
    printf("[WebChuGL] Starting renderer...\n");

    // Initialize command queue
    CQ_Init();

    // Start the ChuGL graphics loop (renderer only)
    chugl_main_loop_hook(nullptr);
}

} // extern "C"

int main(int argc, char** argv)
{
    printf("[WebChuGL] Initializing...\n");

    // Check if we should run in renderer-only mode
    renderer_only_mode = check_renderer_only_mode();

    if (renderer_only_mode) {
        printf("[WebChuGL] Renderer-only mode (no program.ck found)\n");

        // In renderer-only mode, we DON'T load ChucK or ChuGL module.
        // This avoids creating default scene graph objects that would conflict
        // with objects created by the audio worklet's ChucK instance.
        //
        // We just need to:
        // 1. Initialize the command queue (for receiving commands from audio worklet)
        // 2. Start the render loop (which initializes R components via Component_Init)
        //
        // Note: We DON'T call SG_Init() because:
        // - SG components live in the audio worklet's ChucK instance
        // - The main thread only has R components (created from commands)

        // Initialize sokol_time (needed for frame timing)
        stm_setup();

        // Initialize command queue
        CQ_Init();

        printf("[WebChuGL] Command queue initialized for renderer-only mode\n");

        // Start the graphics loop
        // Commands will be injected by JavaScript from the audio worklet
        chugl_main_loop_hook(nullptr);

        return 0;
    }

    // Standard mode: Initialize ChucK and run program.ck
    printf("[WebChuGL] Standard mode (program.ck found)\n");

    // Create ChucK instance
    the_chuck = new ChucK();

    // Configure parameters
    the_chuck->setParam(CHUCK_PARAM_SAMPLE_RATE, (t_CKINT)48000);
    the_chuck->setParam(CHUCK_PARAM_INPUT_CHANNELS, (t_CKINT)0);
    the_chuck->setParam(CHUCK_PARAM_OUTPUT_CHANNELS, (t_CKINT)2);
    the_chuck->setParam(CHUCK_PARAM_VM_HALT, (t_CKINT)0); // don't halt when no shreds
    the_chuck->setParam(CHUCK_PARAM_CHUGIN_ENABLE, (t_CKINT)0); // no external chugins

    // Initialize ChucK (VM, compiler, etc.)
    if (!the_chuck->init()) {
        printf("[WebChuGL] ERROR: Failed to initialize ChucK\n");
        return 1;
    }
    printf("[WebChuGL] ChucK initialized (sr=%d)\n", 48000);

    // Load ChuGL as a built-in module
    if (!the_chuck->compiler()->bind(ck_query, "ChuGL", "global")) {
        printf("[WebChuGL] ERROR: Failed to load ChuGL module\n");
        return 1;
    }
    printf("[WebChuGL] ChuGL module loaded\n");

    // Compile the .ck file from the virtual filesystem
    // (embedded via --preload-file during build)
    if (!the_chuck->compileFile("/program.ck", "", 1, TRUE)) {
        printf("[WebChuGL] ERROR: Failed to compile /program.ck\n");
        return 1;
    }
    printf("[WebChuGL] Program compiled\n");

    // Start the VM
    the_chuck->start();

    // Run the VM briefly to execute initial setup code (before GG.nextFrame())
    // This allows shreds to set up the scene graph before rendering begins.
    {
        static SAMPLE initBuffer[256 * 2];
        the_chuck->run(nullptr, initBuffer, 256);
    }
    printf("[WebChuGL] VM started, entering graphics loop\n");

    // Register the pre-frame callback so the VM advances each frame
    webchugl_set_pre_frame_callback(run_vm_frame, the_chuck);

    // Start the ChuGL graphics loop
    // This calls App::init() + App::start(), which initializes GLFW/WebGPU
    // and enters the emscripten main loop (does not return).
    chugl_main_loop_hook(nullptr);

    // Not reached (emscripten_set_main_loop_arg with simulate_infinite_loop=true)
    return 0;
}
