/*----------------------------------------------------------------------------
  WebChuGL: ChuGL compiled to WebAssembly via Emscripten
  Entry point for the web build.

  Initializes ChucK VM, loads ChuGL module, compiles program.ck, and starts
  the graphics loop. The VM is advanced each frame before rendering.
-----------------------------------------------------------------------------*/
#include "chuck.h"

#include <emscripten.h>
#include <stdio.h>

// ChuGL query function (defined via CK_DLL_QUERY macro in ChuGL.cpp)
extern "C" t_CKBOOL ck_query(Chuck_DL_Query* QUERY);

// ChuGL main loop hook (defined in ChuGL.cpp)
// Calls App::init() + App::start() which sets up GLFW, WebGPU, and the
// emscripten main loop via requestAnimationFrame.
extern t_CKBOOL chugl_main_loop_hook(void* bindle);

// Pre-frame callback registration (defined in app.cpp under __EMSCRIPTEN__)
// Called each frame before rendering to advance the ChucK VM.
extern "C" void webchugl_set_pre_frame_callback(void (*fn)(void*), void* data);

// The ChucK instance
static ChucK* the_chuck = nullptr;

// Samples per frame: 48000 Hz / 60 FPS = 800 samples
static const int SAMPLES_PER_FRAME = 800;

// Pre-frame callback: advances the ChucK VM each frame
static void run_vm_frame(void* data)
{
    ChucK* ck = (ChucK*)data;
    if (ck) {
        static SAMPLE outBuffer[SAMPLES_PER_FRAME * 2]; // stereo
        ck->run(nullptr, outBuffer, SAMPLES_PER_FRAME);
    }
}

int main(int argc, char** argv)
{
    printf("[WebChuGL] Initializing...\n");

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
