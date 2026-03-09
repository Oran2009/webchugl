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

// Track dlopen handles so they're properly closed on shutdown
static std::list<void*> g_chuginHandles;
// Track loaded ChuGin paths to prevent duplicate loading
static std::list<std::string> g_loadedChuginPaths;

// ChuGL query function (defined via CK_DLL_QUERY macro in ChuGL.cpp)
extern "C" t_CKBOOL ck_query(Chuck_DL_Query* QUERY);

// ChuGL main loop hook (defined in ChuGL.cpp)
extern t_CKBOOL chugl_main_loop_hook(void* bindle);

// Pre-frame callback registration (defined in app.cpp under __EMSCRIPTEN__)
extern "C" void webchugl_set_pre_frame_callback(void (*fn)(void*), void* data);

// Stop the emscripten main loop (defined in app.cpp under __EMSCRIPTEN__)
extern "C" void webchugl_stop_main_loop();

// FPS and dt getters (defined in ChuGL sync.cpp)
extern double CHUGL_Window_fps();
extern double CHUGL_Window_dt();

// Frame count (defined in ChuGL ulib_helper.h)
extern long long g_frame_count;

// The ChucK instance
static ChucK* the_chuck = nullptr;

// ============================================================================
// Built-in ChucK class definitions for device sensors (Accel, Gyro)
// These are compiled into the VM before user code so they're always available.
// Matches the WebChucK API: https://github.com/ccrma/webchuck
// ============================================================================

static const char* k_AccelMsg_ck = R"CK(
public class AccelMsg {
    float accelX;
    float accelY;
    float accelZ;

    function float getAccelX() {
        return accelX;
    }

    function float getAccelY() {
        return accelY;
    }

    function float getAccelZ() {
        return accelZ;
    }

    function void _copy(AccelMsg localMsg) {
        localMsg.accelX => accelX;
        localMsg.accelY => accelY;
        localMsg.accelZ => accelZ;
    }
}
)CK";

static const char* k_Accel_ck = R"CK(
global Event _accelReading;
global int _accelActive;

global float _accelX;
global float _accelY;
global float _accelZ;

public class Accel extends Event {

    0 => int isAccelOpen;
    0 => int active;

    string deviceName;

    // AccelMsg Queue
    AccelMsg _accelMsgQueue[0];

    function string name() {
        return deviceName;
    }

    function int openAccel(int num) {
        if (num < 0) {
            false => active;
        } else {
            "js DeviceMotionEvent" => deviceName;
            true => active;
        }
        active => isAccelOpen => _accelActive;
        spork ~ _accelListener();
        return active;
    }

    // Pop the first AccelMsg from the queue
    // Write it to msg and return 1
    function int recv(AccelMsg msg) {
        // is empty
        if (_accelMsgQueue.size() <= 0) {
            return 0;
        }

        // pop the first AccelMsg to msg, return true
        _accelMsgQueue[0] @=> AccelMsg localMsg;
        msg._copy(localMsg);
        _accelMsgQueue.popFront();
        return 1;
    }

    // Accel Listener
    // Get variables from JS and write to the AccelMsg
    function void _accelListener() {
        AccelMsg @ msg;
        while(true){
            new AccelMsg @=> msg;
            _accelReading => now;

            _accelX => msg.accelX;
            _accelY => msg.accelY;
            _accelZ => msg.accelZ;

            _accelMsgQueue << msg;
            this.broadcast();
        }
    }
}
)CK";

static const char* k_GyroMsg_ck = R"CK(
public class GyroMsg {
    float gyroX;
    float gyroY;
    float gyroZ;

    function float getGyroX() {
        return gyroX;
    }

    function float getGyroY() {
        return gyroY;
    }

    function float getGyroZ() {
        return gyroZ;
    }

    function void _copy(GyroMsg localMsg) {
        localMsg.gyroX => gyroX;
        localMsg.gyroY => gyroY;
        localMsg.gyroZ => gyroZ;
    }
}
)CK";

static const char* k_Gyro_ck = R"CK(
global Event _gyroReading;
global int _gyroActive;

global float _gyroX;
global float _gyroY;
global float _gyroZ;

public class Gyro extends Event {

    0 => int isGyroOpen;
    0 => int active;

    string deviceName;

    // GyroMsg Queue
    GyroMsg _gyroMsgQueue[0];

    function string name() {
        return deviceName;
    }

    function int openGyro(int num) {
        if (num < 0) {
            false => active;
        } else {
            "js DeviceOrientationEvent" => deviceName;
            true => active;
        }
        active => isGyroOpen => _gyroActive;
        spork ~ _gyroListener();
        return active;
    }

    // Pop the first GyroMsg from the queue
    // Write it to msg and return 1
    function int recv(GyroMsg msg) {
        // is empty
        if (_gyroMsgQueue.size() <= 0) {
            return 0;
        }

        // pop the first GyroMsg to msg, return true
        _gyroMsgQueue[0] @=> GyroMsg localMsg;
        msg._copy(localMsg);
        _gyroMsgQueue.popFront();
        return 1;
    }

    // Gyro Listener
    // Get variables from JS and write to the GyroMsg
    function void _gyroListener() {
        GyroMsg @ msg;
        while(true){
            new GyroMsg @=> msg;
            _gyroReading => now;

            _gyroX => msg.gyroX;
            _gyroY => msg.gyroY;
            _gyroZ => msg.gyroZ;

            _gyroMsgQueue << msg;
            this.broadcast();
        }
    }
}
)CK";

// Audio defaults — overridden by Module._audioConfig (set from URL params / JS API).
// These are the single source of truth, passed to JS at init time.
static int g_sampleRate = 48000;
static int g_numOutputChannels = 2;
static int g_numInputChannels = 2;
static int g_maxSamplesPerCall = 4800;  // derived: g_sampleRate / 10 (100ms cap)

static std::chrono::high_resolution_clock::time_point g_lastAudioTime;

static bool g_needsMicrophone = false;
static bool g_micRequested = false;

// Initialize the audio system via JS AudioWorkletProcessor
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
                $7,          // needsMic
                $8,          // sampleRate
                $9,          // outChannels
                $10          // inChannels
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
    g_needsMicrophone ? 1 : 0,
    g_sampleRate,
    g_numOutputChannels,
    g_numInputChannels);
}

// Check if adc is now in use and request microphone if needed.
// Called each frame after ck->run() so that UGen connections (adc => ...)
// established during shred execution are detected.  Guarded by
// g_micRequested so it becomes a single boolean check after the first trigger.
static void checkAndRequestMic()
{
    if (g_micRequested) return;
    if (!the_chuck) return;

    Chuck_UGen* adc = the_chuck->vm()->m_adc;
    if (!adc) return;

    bool needsMic = false;
    if (adc->m_num_dest > 0) {
        needsMic = true;
    }
    if (!needsMic && adc->m_multi_chan) {
        for (t_CKUINT i = 0; i < adc->m_multi_chan_size; i++) {
            if (adc->m_multi_chan[i] && adc->m_multi_chan[i]->m_num_dest > 0) {
                needsMic = true;
                break;
            }
        }
    }

    if (needsMic) {
        g_micRequested = true;
        printf("[WebChuGL] ADC in use — requesting microphone\n");
        EM_ASM({
            if (typeof Module._connectMic === 'function') {
                Module._connectMic();
            }
        });
    }
}

// Pre-frame callback: advances the ChucK VM based on elapsed time
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

        // Always run ChucK VM (needed for graphics via GG.nextFrame())
        ck->run(inBuffer, outBuffer, samplesToGenerate);

        // UGen connections (adc => ...) happen during ck->run(), so check here
        checkAndRequestMic();

        // Write ChucK's planar output directly to ring buffer
        uint32_t available = ringAvailableToWrite();
        if (available >= (uint32_t)samplesToGenerate) {
            ringWrite(outBuffer, samplesToGenerate, samplesToGenerate);
        }
    }
}

int main(int argc, char** argv)
{
    // Suppress ChuGL debug/trace messages, only show warnings and errors
    log_set_level(LOG_WARN);

    printf("[WebChuGL] Initializing...\n");

    // Read audio config from Module._audioConfig (set by JS from URL params / API)
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
    // Clamp to sane range
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

    // IMPORTANT: start() must be called BEFORE compileFile() so that
    // static initialization shreds can execute properly (they check m_is_running)
    the_chuck->start();

    // Compile built-in sensor classes
    if (!the_chuck->compileCode(k_AccelMsg_ck, "", 1, TRUE) ||
        !the_chuck->compileCode(k_Accel_ck, "", 1, TRUE) ||
        !the_chuck->compileCode(k_GyroMsg_ck, "", 1, TRUE) ||
        !the_chuck->compileCode(k_Gyro_ck, "", 1, TRUE)) {
        printf("[WebChuGL] WARNING: Failed to compile built-in sensor classes\n");
    }

    // Check if adc is used
    Chuck_UGen* adc = the_chuck->vm()->m_adc;
    if (adc) {
        if (adc->m_num_dest > 0) {
            g_needsMicrophone = true;
        }
        // Also check individual channel UGens (e.g. adc.chan(0) => ...)
        if (!g_needsMicrophone && adc->m_multi_chan) {
            for (t_CKUINT i = 0; i < adc->m_multi_chan_size; i++) {
                if (adc->m_multi_chan[i] && adc->m_multi_chan[i]->m_num_dest > 0) {
                    g_needsMicrophone = true;
                    break;
                }
            }
        }
        if (g_needsMicrophone) {
            g_micRequested = true;
            printf("[WebChuGL] ADC in use - microphone will be requested\n");
        }
    }

    g_lastAudioTime = std::chrono::high_resolution_clock::now();
    initRingBuffers(g_numOutputChannels, g_numInputChannels);
    initAudio();

    webchugl_set_pre_frame_callback(run_vm_frame, the_chuck);

    printf("[WebChuGL] Starting...\n");
    chugl_main_loop_hook(nullptr);

    return 0;
}

// ============================================================================
// Host ↔ ChucK bridge (exposed to JS via Module.ccall)
// Uses Chuck_Globals_Manager's thread-safe lock-free queue
// ============================================================================

// --- EM_JS dispatchers: called from C++ callbacks, dispatch into JS --------

// Parent-container resize: overrides contrib.glfw3's computeSize to track
// canvas.parentElement instead of the browser window, and installs a
// ResizeObserver so container size changes trigger the GLFW3 resize pipeline.
EM_JS(void, _chugl_setup_parent_resize, (), {
    var canvas = Module['canvas'];
    if (!canvas) return;
    var parent = canvas.parentElement;
    if (!parent) return;

    var glfwWindow = Module['glfwGetWindow'](canvas);
    if (glfwWindow == null || typeof GLFW3 === 'undefined') return;
    var ctx = GLFW3.fWindowContexts[glfwWindow];
    if (!ctx || !ctx.fCanvasResize) return;

    // Prevent GLFW from setting inline CSS width/height on the canvas.
    // By default, contrib.glfw3's onSizeChanged sets pixel values like
    // `width: 640px; height: 480px` on the canvas element. When the
    // canvas is in normal flow, this affects the parent's layout →
    // the ResizeObserver fires → reads new parent size → GLFW sets
    // new pixel values → infinite loop. By no-opping onSizeChanged,
    // GLFW still updates the canvas buffer resolution (canvas.width /
    // canvas.height attributes) but never touches CSS display size.
    // The canvas fills its parent via the CSS set below.
    ctx.fCanvasResize.onSizeChanged = function() {};

    // Set canvas to fill its parent. display:block prevents the inline
    // element's default baseline gap from adding extra height.
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';

    // Override computeSize to return parent container dimensions.
    // Read canvas.parentElement dynamically so re-parenting is supported.
    ctx.fCanvasResize.computeSize = function() {
        var p = canvas.parentElement;
        return p ? { width: p.clientWidth, height: p.clientHeight }
                 : { width: window.innerWidth, height: window.innerHeight };
    };

    // Watch the parent for size changes and trigger GLFW3's resize handler.
    // NOTE: The observer watches the parent at setup time. If the canvas is
    // re-parented, call chugl_setup_parent_resize() again to observe the new
    // parent. (computeSize reads canvas.parentElement dynamically, so sizing
    // still works — only the observer would be stale.)
    if (canvas._chuglParentObserver) {
        canvas._chuglParentObserver.disconnect();
    }
    // Helper: trigger GLFW3's resize pipeline directly (no global event).
    function triggerGLFWResize() {
        var size = ctx.fCanvasResize.computeSize();
        GLFW3.onWindowResize(glfwWindow, size.width, size.height);
    }

    var lastW = 0, lastH = 0;
    canvas._chuglParentObserver = new ResizeObserver(function() {
        var size = ctx.fCanvasResize.computeSize();
        if (size.width === lastW && size.height === lastH) return;
        lastW = size.width;
        lastH = size.height;
        triggerGLFWResize();
    });
    canvas._chuglParentObserver.observe(parent);

    // Trigger an initial resize so the canvas picks up the parent size now
    triggerGLFWResize();
});

extern "C" EMSCRIPTEN_KEEPALIVE
void chugl_setup_parent_resize()
{
    _chugl_setup_parent_resize();
}

// Letterbox setup for contrib.glfw3: overrides the resize observer's computeSize
// to return shrink-to-fit dimensions, and centers the canvas in its parent.
// Called from app.cpp's SG_COMMAND_WINDOW_SIZE_LIMITS handler.
//
// Instead of modifying the parent element's inline styles (which would override
// host-application CSS like Tailwind's .hidden), we insert an owned wrapper
// <div> between the parent and the canvas.
EM_JS(void, _chugl_setup_letterbox, (double ar_x, double ar_y), {
    var canvas = Module['canvas'];
    if (!canvas) return;
    var hasAspect = (ar_x > 0 && ar_y > 0);

    // -- Wrapper management ------------------------------------------------
    // Create or remove a wrapper <div> owned by WebChuGL for flex centering.
    // The host's parent element is never touched.
    if (hasAspect) {
        var wrapper = canvas._chuglWrapper;
        if (!wrapper) {
            wrapper = document.createElement('div');
            canvas._chuglWrapper = wrapper;
            var parent = canvas.parentElement;
            if (parent) {
                parent.insertBefore(wrapper, canvas);
                wrapper.appendChild(canvas);
            }
        }
        wrapper.style.display = 'flex';
        wrapper.style.justifyContent = 'center';
        wrapper.style.alignItems = 'center';
        wrapper.style.width = '100%';
        wrapper.style.height = '100%';
    } else {
        var wrapper = canvas._chuglWrapper;
        if (wrapper && wrapper.parentElement) {
            wrapper.parentElement.insertBefore(canvas, wrapper);
            wrapper.parentElement.removeChild(wrapper);
        }
        canvas._chuglWrapper = null;
    }

    // -- computeSize override ----------------------------------------------
    // Override contrib.glfw3 resize observer's computeSize so it returns
    // letterboxed (shrink-to-fit) dimensions instead of full viewport.
    var glfwWindow = Module['glfwGetWindow'](canvas);
    if (glfwWindow != null && typeof GLFW3 !== 'undefined') {
        var ctx = GLFW3.fWindowContexts[glfwWindow];
        if (ctx && ctx.fCanvasResize) {
            if (hasAspect) {
                var ar = ar_x / ar_y;
                ctx.fCanvasResize.computeSize = function() {
                    // Read the wrapper's parent (the host container) for
                    // available space, since the wrapper fills it at 100%.
                    var w = canvas._chuglWrapper;
                    var p = w ? w.parentElement : canvas.parentElement;
                    var vw = p ? p.clientWidth : window.innerWidth;
                    var vh = p ? p.clientHeight : window.innerHeight;
                    if (vw / vh > ar) {
                        return {width: Math.round(vh * ar), height: vh};
                    } else {
                        return {width: vw, height: Math.round(vw / ar)};
                    }
                };
            } else {
                ctx.fCanvasResize.computeSize = function() {
                    var p = canvas.parentElement;
                    return {
                        width:  p ? p.clientWidth  : window.innerWidth,
                        height: p ? p.clientHeight : window.innerHeight
                    };
                };
            }
            // Trigger immediate resize with new computeSize (no global event)
            var size = ctx.fCanvasResize.computeSize();
            GLFW3.onWindowResize(glfwWindow, size.width, size.height);
        }
    }
});

EM_JS(void, _ck_resolve_int, (int id, int val), {
    var cb = Module._ckCallbacks[id];
    if (cb) { cb(val); delete Module._ckCallbacks[id]; }
});

EM_JS(void, _ck_resolve_float, (int id, double val), {
    var cb = Module._ckCallbacks[id];
    if (cb) { cb(val); delete Module._ckCallbacks[id]; }
});

EM_JS(void, _ck_resolve_string, (int id, const char* val), {
    var cb = Module._ckCallbacks[id];
    if (cb) { cb(UTF8ToString(val)); delete Module._ckCallbacks[id]; }
});

EM_JS(void, _ck_resolve_int_array, (int id, int* arr, unsigned int len), {
    var cb = Module._ckCallbacks[id];
    if (cb) {
        var result = new Array(len);
        for (var i = 0; i < len; i++) result[i] = getValue(arr + i * 4, 'i32');
        cb(result);
        delete Module._ckCallbacks[id];
    }
});

EM_JS(void, _ck_resolve_float_array, (int id, double* arr, unsigned int len), {
    var cb = Module._ckCallbacks[id];
    if (cb) {
        var result = new Array(len);
        for (var i = 0; i < len; i++) result[i] = getValue(arr + i * 8, 'double');
        cb(result);
        delete Module._ckCallbacks[id];
    }
});

EM_JS(void, _ck_dispatch_event, (int id), {
    var entry = Module._ckEventListeners[id];
    if (entry) {
        entry.callback();
        if (entry.once) delete Module._ckEventListeners[id];
    }
});

// --- Static C++ callbacks (match ck_get_id signatures from chuck_globals.h) -

// NOTE: Under __EMSCRIPTEN__, t_CKINT is defined as int (32-bit).
// The casts below are identity conversions for the wasm32 target.
static void _cb_get_int(t_CKINT id, t_CKINT val)
{ _ck_resolve_int((int)id, (int)val); }

static void _cb_get_float(t_CKINT id, t_CKFLOAT val)
{ _ck_resolve_float((int)id, val); }

static void _cb_get_string(t_CKINT id, const char* val)
{ _ck_resolve_string((int)id, val); }

static void _cb_get_int_array(t_CKINT id, t_CKINT a[], t_CKUINT n)
{ _ck_resolve_int_array((int)id, (int*)a, (unsigned int)n); }

static void _cb_get_float_array(t_CKINT id, t_CKFLOAT a[], t_CKUINT n)
{ _ck_resolve_float_array((int)id, (double*)a, (unsigned int)n); }

static void _cb_event(t_CKINT id)
{ _ck_dispatch_event((int)id); }

// Escape JSON-special characters for safe embedding in JSON string values
// Per RFC 8259 §7: all U+0000–U+001F must be escaped.
static void appendJsonEscaped(std::string& out, const std::string& s) {
    for (size_t i = 0; i < s.size(); i++) {
        unsigned char c = (unsigned char)s[i];
        if (c == '"')       out += "\\\"";
        else if (c == '\\') out += "\\\\";
        else if (c == '\n') out += "\\n";
        else if (c == '\r') out += "\\r";
        else if (c == '\t') out += "\\t";
        else if (c < 0x20) {
            char buf[8];
            snprintf(buf, sizeof(buf), "\\u%04x", c);
            out += buf;
        }
        else out += s[i];
    }
}

// --- Exported functions ------------------------------

extern "C" {

// ---- Scalar setters --------------------------------------------

EMSCRIPTEN_KEEPALIVE
int ck_set_int(const char* name, int val)
{
    if (!the_chuck) return 0;
    return the_chuck->vm()->globals_manager()->setGlobalInt(name, (t_CKINT)val);
}

EMSCRIPTEN_KEEPALIVE
int ck_set_float(const char* name, double val)
{
    if (!the_chuck) return 0;
    return the_chuck->vm()->globals_manager()->setGlobalFloat(name, (t_CKFLOAT)val);
}

EMSCRIPTEN_KEEPALIVE
int ck_set_string(const char* name, const char* val)
{
    if (!the_chuck) return 0;
    return the_chuck->vm()->globals_manager()->setGlobalString(name, val);
}

// ---- Scalar getters -------------------------------------------------

EMSCRIPTEN_KEEPALIVE
int ck_get_int(const char* name, int callback_id)
{
    if (!the_chuck) return 0;
    return the_chuck->vm()->globals_manager()->getGlobalInt(
        name, (t_CKINT)callback_id, _cb_get_int);
}

EMSCRIPTEN_KEEPALIVE
int ck_get_float(const char* name, int callback_id)
{
    if (!the_chuck) return 0;
    return the_chuck->vm()->globals_manager()->getGlobalFloat(
        name, (t_CKINT)callback_id, _cb_get_float);
}

EMSCRIPTEN_KEEPALIVE
int ck_get_string(const char* name, int callback_id)
{
    if (!the_chuck) return 0;
    return the_chuck->vm()->globals_manager()->getGlobalString(
        name, (t_CKINT)callback_id, _cb_get_string);
}

// ---- Events --------------------

EMSCRIPTEN_KEEPALIVE
int ck_signal_event(const char* name)
{
    if (!the_chuck) return 0;
    return the_chuck->vm()->globals_manager()->signalGlobalEvent(name);
}

EMSCRIPTEN_KEEPALIVE
int ck_broadcast_event(const char* name)
{
    if (!the_chuck) return 0;
    return the_chuck->vm()->globals_manager()->broadcastGlobalEvent(name);
}

EMSCRIPTEN_KEEPALIVE
int ck_listen_event(const char* name, int callback_id, int listen_forever)
{
    if (!the_chuck) return 0;
    return the_chuck->vm()->globals_manager()->listenForGlobalEvent(
        name, (t_CKINT)callback_id, _cb_event, (t_CKBOOL)listen_forever);
}

EMSCRIPTEN_KEEPALIVE
int ck_stop_listening_event(const char* name, int callback_id)
{
    if (!the_chuck) return 0;
    return the_chuck->vm()->globals_manager()->stopListeningForGlobalEvent(
        name, (t_CKINT)callback_id, _cb_event);
}

// ---- Int array operations -------------------------------------------

EMSCRIPTEN_KEEPALIVE
int ck_set_int_array(const char* name, int* values, unsigned int len)
{
    if (!the_chuck) return 0;
    return the_chuck->vm()->globals_manager()->setGlobalIntArray(
        name, (t_CKINT*)values, (t_CKUINT)len);
}

EMSCRIPTEN_KEEPALIVE
int ck_get_int_array(const char* name, int callback_id)
{
    if (!the_chuck) return 0;
    return the_chuck->vm()->globals_manager()->getGlobalIntArray(
        name, (t_CKINT)callback_id, _cb_get_int_array);
}

EMSCRIPTEN_KEEPALIVE
int ck_set_int_array_value(const char* name, unsigned int index, int value)
{
    if (!the_chuck) return 0;
    return the_chuck->vm()->globals_manager()->setGlobalIntArrayValue(
        name, (t_CKUINT)index, (t_CKINT)value);
}

EMSCRIPTEN_KEEPALIVE
int ck_get_int_array_value(const char* name, unsigned int index, int callback_id)
{
    if (!the_chuck) return 0;
    return the_chuck->vm()->globals_manager()->getGlobalIntArrayValue(
        name, (t_CKINT)callback_id, (t_CKUINT)index, _cb_get_int);
}

EMSCRIPTEN_KEEPALIVE
int ck_set_assoc_int_array_value(const char* name, const char* key, int value)
{
    if (!the_chuck) return 0;
    return the_chuck->vm()->globals_manager()->setGlobalAssociativeIntArrayValue(
        name, key, (t_CKINT)value);
}

EMSCRIPTEN_KEEPALIVE
int ck_get_assoc_int_array_value(const char* name, const char* key, int callback_id)
{
    if (!the_chuck) return 0;
    return the_chuck->vm()->globals_manager()->getGlobalAssociativeIntArrayValue(
        name, (t_CKINT)callback_id, key, _cb_get_int);
}

// ---- Float array operations -----------------------------------------

EMSCRIPTEN_KEEPALIVE
int ck_set_float_array(const char* name, double* values, unsigned int len)
{
    if (!the_chuck) return 0;
    return the_chuck->vm()->globals_manager()->setGlobalFloatArray(
        name, (t_CKFLOAT*)values, (t_CKUINT)len);
}

EMSCRIPTEN_KEEPALIVE
int ck_get_float_array(const char* name, int callback_id)
{
    if (!the_chuck) return 0;
    return the_chuck->vm()->globals_manager()->getGlobalFloatArray(
        name, (t_CKINT)callback_id, _cb_get_float_array);
}

EMSCRIPTEN_KEEPALIVE
int ck_set_float_array_value(const char* name, unsigned int index, double value)
{
    if (!the_chuck) return 0;
    return the_chuck->vm()->globals_manager()->setGlobalFloatArrayValue(
        name, (t_CKUINT)index, (t_CKFLOAT)value);
}

EMSCRIPTEN_KEEPALIVE
int ck_get_float_array_value(const char* name, unsigned int index, int callback_id)
{
    if (!the_chuck) return 0;
    return the_chuck->vm()->globals_manager()->getGlobalFloatArrayValue(
        name, (t_CKINT)callback_id, (t_CKUINT)index, _cb_get_float);
}

EMSCRIPTEN_KEEPALIVE
int ck_set_assoc_float_array_value(const char* name, const char* key, double value)
{
    if (!the_chuck) return 0;
    return the_chuck->vm()->globals_manager()->setGlobalAssociativeFloatArrayValue(
        name, key, (t_CKFLOAT)value);
}

EMSCRIPTEN_KEEPALIVE
int ck_get_assoc_float_array_value(const char* name, const char* key, int callback_id)
{
    if (!the_chuck) return 0;
    return the_chuck->vm()->globals_manager()->getGlobalAssociativeFloatArrayValue(
        name, (t_CKINT)callback_id, key, _cb_get_float);
}

// ---- Compilation diagnostics (shared buffer + callback) -------------

// ---- Code execution -------------------------------------------------

EMSCRIPTEN_KEEPALIVE
int ck_run_code(const char* code)
{
    if (!the_chuck) return 0;

    std::vector<t_CKUINT> shredIDs;
    bool ok = the_chuck->compileCode(code, "", 1, TRUE, &shredIDs);

    if (!ok) return 0;
    return shredIDs.empty() ? 0 : (int)shredIDs[0];
}

EMSCRIPTEN_KEEPALIVE
int ck_run_file(const char* path)
{
    if (!the_chuck) return 0;

    std::vector<t_CKUINT> shredIDs;
    bool ok = the_chuck->compileFile(path, "", 1, TRUE, &shredIDs);

    if (!ok) return 0;
    return shredIDs.empty() ? 0 : (int)shredIDs[0];
}

EMSCRIPTEN_KEEPALIVE
int ck_run_file_with_args(const char* path, const char* colonSeparatedArgs)
{
    if (!the_chuck) return 0;

    std::vector<t_CKUINT> shredIDs;
    bool ok = the_chuck->compileFile(path, colonSeparatedArgs ? colonSeparatedArgs : "",
                                     1, TRUE, &shredIDs);

    if (!ok) return 0;
    return shredIDs.empty() ? 0 : (int)shredIDs[0];
}

// ---- Shred management -----------------------------------------------

// Find the highest active shred ID (the "last" shred)
static t_CKUINT _find_last_shred_id()
{
    if (!the_chuck) return 0;
    // Iterate down from last_id to find the highest active shred
    t_CKUINT xid = the_chuck->vm()->last_id();
    while (xid > 0) {
        if (the_chuck->vm()->shreduler()->lookup(xid)) return xid;
        xid--;
    }
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int ck_remove_shred(unsigned int shredID)
{
    if (!the_chuck) return 0;
    // Verify shred exists
    if (!the_chuck->vm()->shreduler()->lookup(shredID)) return 0;
    // Queue removal — processed on next vm run() call
    Chuck_Msg* msg = new Chuck_Msg;
    msg->type = CK_MSG_REMOVE;
    msg->param = (t_CKUINT)shredID;
    the_chuck->vm()->queue_msg(msg);
    return (int)shredID;
}

EMSCRIPTEN_KEEPALIVE
int ck_remove_last_code()
{
    if (!the_chuck) return 0;
    t_CKUINT xid = _find_last_shred_id();
    if (xid == 0) return 0;
    // Queue removal with CK_NO_VALUE to use VM's "remove last" logic
    Chuck_Msg* msg = new Chuck_Msg;
    msg->type = CK_MSG_REMOVE;
    msg->param = CK_NO_VALUE;
    the_chuck->vm()->queue_msg(msg);
    return (int)xid;
}

// Static storage for replace results (old/new shred IDs)
static int g_replaceOldShred = 0;
static int g_replaceNewShred = 0;

EMSCRIPTEN_KEEPALIVE
int ck_replace_code(const char* code)
{
    if (!the_chuck) return 0;
    g_replaceOldShred = 0;
    g_replaceNewShred = 0;

    // Find last active shred
    t_CKUINT oldXid = _find_last_shred_id();
    if (oldXid == 0) return 0;

    // Queue removal of old shred
    Chuck_Msg* msg = new Chuck_Msg;
    msg->type = CK_MSG_REMOVE;
    msg->param = oldXid;
    the_chuck->vm()->queue_msg(msg);

    // Compile new code immediately
    std::vector<t_CKUINT> newIDs;
    if (!the_chuck->compileCode(code, "", 1, TRUE, &newIDs) || newIDs.empty())
        return 0;

    g_replaceOldShred = (int)oldXid;
    g_replaceNewShred = (int)newIDs[0];
    return 1;
}

EMSCRIPTEN_KEEPALIVE
int ck_replace_file(const char* path)
{
    if (!the_chuck) return 0;
    g_replaceOldShred = 0;
    g_replaceNewShred = 0;

    t_CKUINT oldXid = _find_last_shred_id();
    if (oldXid == 0) return 0;

    Chuck_Msg* msg = new Chuck_Msg;
    msg->type = CK_MSG_REMOVE;
    msg->param = oldXid;
    the_chuck->vm()->queue_msg(msg);

    std::vector<t_CKUINT> newIDs;
    if (!the_chuck->compileFile(path, "", 1, TRUE, &newIDs) || newIDs.empty())
        return 0;

    g_replaceOldShred = (int)oldXid;
    g_replaceNewShred = (int)newIDs[0];
    return 1;
}

EMSCRIPTEN_KEEPALIVE
int ck_replace_file_with_args(const char* path, const char* colonSeparatedArgs)
{
    if (!the_chuck) return 0;
    g_replaceOldShred = 0;
    g_replaceNewShred = 0;

    t_CKUINT oldXid = _find_last_shred_id();
    if (oldXid == 0) return 0;

    Chuck_Msg* msg = new Chuck_Msg;
    msg->type = CK_MSG_REMOVE;
    msg->param = oldXid;
    the_chuck->vm()->queue_msg(msg);

    std::vector<t_CKUINT> newIDs;
    if (!the_chuck->compileFile(path, colonSeparatedArgs ? colonSeparatedArgs : "",
                                1, TRUE, &newIDs) || newIDs.empty())
        return 0;

    g_replaceOldShred = (int)oldXid;
    g_replaceNewShred = (int)newIDs[0];
    return 1;
}

EMSCRIPTEN_KEEPALIVE
int ck_get_replace_old_shred() { return g_replaceOldShred; }

EMSCRIPTEN_KEEPALIVE
int ck_get_replace_new_shred() { return g_replaceNewShred; }

EMSCRIPTEN_KEEPALIVE
int ck_is_shred_active(unsigned int shredID)
{
    if (!the_chuck) return 0;
    return the_chuck->vm()->shreduler()->lookup(shredID) ? 1 : 0;
}

// ---- VM parameters --------------------------------------------------

EMSCRIPTEN_KEEPALIVE
void ck_set_param_int(const char* name, int val)
{
    if (!the_chuck) return;
    the_chuck->setParam(name, (t_CKINT)val);
}

EMSCRIPTEN_KEEPALIVE
int ck_get_param_int(const char* name)
{
    if (!the_chuck) return 0;
    return (int)the_chuck->getParamInt(name);
}

EMSCRIPTEN_KEEPALIVE
void ck_set_param_float(const char* name, double val)
{
    if (!the_chuck) return;
    the_chuck->setParamFloat(name, (t_CKFLOAT)val);
}

EMSCRIPTEN_KEEPALIVE
double ck_get_param_float(const char* name)
{
    if (!the_chuck) return 0.0;
    return (double)the_chuck->getParamFloat(name);
}

EMSCRIPTEN_KEEPALIVE
void ck_set_param_string(const char* name, const char* val)
{
    if (!the_chuck) return;
    the_chuck->setParam(name, std::string(val));
}

EMSCRIPTEN_KEEPALIVE
const char* ck_get_param_string(const char* name)
{
    static std::string result;
    if (!the_chuck) return "";
    result = the_chuck->getParamString(name);
    return result.c_str();
}

// ---- VM reset -------------------------------------------------------

EMSCRIPTEN_KEEPALIVE
void ck_clear_instance()
{
    if (!the_chuck) return;
    the_chuck->removeAllShreds();
    // Reset letterbox state so the next program starts with default sizing.
    _chugl_setup_letterbox(0, 0);
}

EMSCRIPTEN_KEEPALIVE
void ck_clear_globals()
{
    if (!the_chuck) return;
    Chuck_Msg* msg = new Chuck_Msg;
    msg->type = CK_MSG_CLEARGLOBALS;
    the_chuck->vm()->queue_msg(msg);
}

// Defined in ChuGL.cpp — resets scene, camera, render pipeline, FPS to defaults.
extern void chugl_init_default_setup_impl();

EMSCRIPTEN_KEEPALIVE
void ck_reset_graphics()
{
    chugl_init_default_setup_impl();
}

EMSCRIPTEN_KEEPALIVE
void ck_stop_render_loop()
{
    webchugl_stop_main_loop();
}

// ---- Print callback -------------------------------------------------
// Redirects ChucK stdout (chout) to JS via Module._onChuckPrint

EM_JS(void, _ck_dispatch_print, (const char* msg), {
    if (Module._onChuckPrint) {
        Module._onChuckPrint(UTF8ToString(msg));
    }
});

static void _chout_callback(const char* msg) {
    _ck_dispatch_print(msg);
}

EMSCRIPTEN_KEEPALIVE
void ck_set_print_callback(int enabled)
{
    if (!the_chuck) return;
    the_chuck->setChoutCallback(enabled ? _chout_callback : NULL);
}

// ---- ChuGin info ----------------------------------------------------

EMSCRIPTEN_KEEPALIVE
const char* ck_get_loaded_chugins()
{
    static std::string result;
    result = "[";
    bool first = true;
    for (const auto& path : g_loadedChuginPaths) {
        if (!first) result += ",";
        first = false;
        // Extract short name
        size_t slashPos = path.rfind('/');
        std::string name = (slashPos == std::string::npos)
            ? path : path.substr(slashPos + 1);
        size_t dotPos = name.find(".chug");
        if (dotPos != std::string::npos) name = name.substr(0, dotPos);
        result += "\"";
        appendJsonEscaped(result, name);
        result += "\"";
    }
    result += "]";
    return result.c_str();
}

// ---- VM introspection -----------------------------------------------

EMSCRIPTEN_KEEPALIVE
double ck_get_fps()
{
    return CHUGL_Window_fps();
}

EMSCRIPTEN_KEEPALIVE
double ck_get_dt()
{
    return CHUGL_Window_dt();
}

EMSCRIPTEN_KEEPALIVE
double ck_get_frame_count()
{
    return (double)g_frame_count;
}

EMSCRIPTEN_KEEPALIVE
int ck_is_vm_running()
{
    if (!the_chuck) return 0;
    return the_chuck->vm_running() ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
double ck_get_now()
{
    if (!the_chuck) return 0.0;
    return (double)the_chuck->now();
}

EMSCRIPTEN_KEEPALIVE
const char* ck_get_active_shreds()
{
    static std::string result;
    if (!the_chuck) return "[]";

    std::vector<Chuck_VM_Shred*> shreds;
    the_chuck->vm()->shreduler()->get_all_shreds(shreds);

    result = "[";
    for (size_t i = 0; i < shreds.size(); i++) {
        if (i > 0) result += ",";
        result += "{\"id\":";
        result += std::to_string(shreds[i]->xid);
        result += ",\"name\":\"";
        appendJsonEscaped(result, shreds[i]->name);
        result += "\"}";
    }
    result += "]";
    return result.c_str();
}

EMSCRIPTEN_KEEPALIVE
const char* ck_get_all_globals()
{
    static std::string result;
    if (!the_chuck) return "[]";

    std::vector<Chuck_Globals_TypeValue> list;
    the_chuck->vm()->globals_manager()->get_all_global_variables(list);

    result = "[";
    for (size_t i = 0; i < list.size(); i++) {
        if (i > 0) result += ",";
        result += "{\"type\":\"";
        appendJsonEscaped(result, list[i].type);
        result += "\",\"name\":\"";
        appendJsonEscaped(result, list[i].name);
        result += "\"}";
    }
    result += "]";
    return result.c_str();
}

EMSCRIPTEN_KEEPALIVE
int ck_run_code_ex(const char* code)
{
    if (!the_chuck) return 0;

    int result = 0;
    try {
        result = the_chuck->compileCode(code, "", 1, TRUE) ? 1 : 0;
    } catch (...) {
        result = 0;
    }

    return result;
}

EMSCRIPTEN_KEEPALIVE
const char* ck_get_last_compile_output()
{
    return EM_lasterror();
}

// ---- ChuGin loading (post-init) ------------------------------------

EMSCRIPTEN_KEEPALIVE
int ck_load_chugin(const char* vfsPath)
{
    if (!the_chuck) return 0;
    if (!vfsPath || vfsPath[0] == '\0') return 0;

    // Prevent loading the same ChuGin twice
    std::string pathStr(vfsPath);
    for (const auto& p : g_loadedChuginPaths) {
        if (p == pathStr) {
            printf("[WebChuGL] ChuGin already loaded: %s\n", vfsPath);
            return 1;
        }
    }

    void* handle = dlopen(vfsPath, RTLD_NOW);
    if (!handle) {
        printf("[WebChuGL] ERROR: dlopen failed for %s: %s\n", vfsPath, dlerror());
        return 0;
    }

    f_ck_query queryFunc = (f_ck_query)dlsym(handle, "ck_query");
    if (!queryFunc) {
        printf("[WebChuGL] ERROR: dlsym(ck_query) failed for %s: %s\n", vfsPath, dlerror());
        dlclose(handle);
        return 0;
    }

    // Extract name from path (e.g. "/chugins/Bitcrusher.chug.wasm" -> "Bitcrusher")
    size_t slashPos = pathStr.rfind('/');
    std::string name = (slashPos == std::string::npos)
        ? pathStr : pathStr.substr(slashPos + 1);
    size_t dotPos = name.find(".chug");
    if (dotPos != std::string::npos) name = name.substr(0, dotPos);

    if (the_chuck->compiler()->bind(queryFunc, name.c_str(), "global")) {
        g_chuginHandles.push_back(handle);
        g_loadedChuginPaths.push_back(pathStr);
        printf("[WebChuGL] Loaded ChuGin: %s\n", name.c_str());
        return 1;
    } else {
        printf("[WebChuGL] ERROR: Failed to bind ChuGin: %s\n", name.c_str());
        dlclose(handle);
        return 0;
    }
}

} // extern "C"
