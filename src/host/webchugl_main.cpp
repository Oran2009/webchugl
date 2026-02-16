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
#include "chuck_globals.h"
#include "audio_ring_buffer.h"
#include "sg_command.h"
#include "core/log.h"

#include <GLFW/glfw3.h>
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

// Audio
static const int NUM_CHANNELS = 2;
static const double SAMPLE_RATE = 48000.0;
static const int MAX_SAMPLES_PER_CALL = 4800;

static std::chrono::high_resolution_clock::time_point g_lastAudioTime;

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
        int inputFloatsWritten = inputRingRead(floatInBuffer, samplesToGenerate);
        // Convert float to SAMPLE and zero-fill if not enough
        for (int i = 0; i < samplesToGenerate * NUM_CHANNELS; i++) {
            inBuffer[i] = (i < inputFloatsWritten) ? (SAMPLE)floatInBuffer[i] : 0;
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
    // Note: web chugins (for webchugl) require SIDE_MODULE=1 and -pthread
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

    // Compile built-in sensor classes
    if (!the_chuck->compileCode(k_AccelMsg_ck, "", 1, TRUE) ||
        !the_chuck->compileCode(k_Accel_ck, "", 1, TRUE) ||
        !the_chuck->compileCode(k_GyroMsg_ck, "", 1, TRUE) ||
        !the_chuck->compileCode(k_Gyro_ck, "", 1, TRUE)) {
        printf("[WebChuGL] WARNING: Failed to compile built-in sensor classes\n");
    }

    if (!the_chuck->compileFile("/code/main.ck", "", 1, TRUE)) {
        printf("[WebChuGL] ERROR: Failed to compile /code/main.ck\n");
        return 1;
    }

    // Run VM briefly to execute initial setup code before GG.nextFrame()
    {
        static SAMPLE initBuffer[256 * NUM_CHANNELS];
        the_chuck->run(nullptr, initBuffer, 256);
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
            printf("[WebChuGL] ADC in use - microphone will be requested\n");
        }
    }

    g_lastAudioTime = std::chrono::high_resolution_clock::now();
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

// Enforce canvas aspect ratio via a <style> tag, then sync the canvas buffer
// to the new CSS display size (with DPR scaling). Called from app.cpp's
// SG_COMMAND_WINDOW_SIZE_LIMITS handler.
EM_JS(void, _chugl_set_canvas_aspect_ratio,
      (double ar_x, double ar_y, int* out_w, int* out_h), {
    var STYLE_ID = 'chugl-aspect-style';
    var CANVAS_ID = 'canvas';
    var s = document.getElementById(STYLE_ID);
    if (ar_x > 0 && ar_y > 0) {
        if (!s) {
            s = document.createElement('style');
            s.id = STYLE_ID;
            document.head.appendChild(s);
        }
        s.textContent =
            'body { display:flex; justify-content:center; align-items:center; } ' +
            '#' + CANVAS_ID + ' { ' +
            'width: min(100vw, 100vh * ' + ar_x + ' / ' + ar_y + ') !important; ' +
            'height: min(100vh, 100vw * ' + ar_y + ' / ' + ar_x + ') !important; ' +
            '}';
    } else {
        if (s) s.remove();
    }
    // Sync canvas buffer to the (possibly changed) CSS display size
    var c = document.getElementById(CANVAS_ID);
    var dpr = devicePixelRatio || 1;
    var rect = c.getBoundingClientRect();
    var w = Math.round(rect.width * dpr);
    var h = Math.round(rect.height * dpr);
    c.width = w;
    c.height = h;
    HEAP32[out_w >> 2] = w;
    HEAP32[out_h >> 2] = h;
});

// DPR correction for the canvas buffer. Called from app.cpp's _onFramebufferResize.
EM_JS(void, _chugl_sync_canvas_dpr,
      (int cur_w, int cur_h, int* out_w, int* out_h), {
    var c = document.getElementById('canvas');
    var dpr = devicePixelRatio || 1;
    var rect = c.getBoundingClientRect();
    var w = Math.round(rect.width * dpr);
    var h = Math.round(rect.height * dpr);
    if (cur_w !== w || cur_h !== h) {
        c.width = w;
        c.height = h;
    }
    HEAP32[out_w >> 2] = w;
    HEAP32[out_h >> 2] = h;
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
        for (var i = 0; i < len; i++) result[i] = HEAP32[(arr >> 2) + i];
        cb(result);
        delete Module._ckCallbacks[id];
    }
});

EM_JS(void, _ck_resolve_float_array, (int id, double* arr, unsigned int len), {
    var cb = Module._ckCallbacks[id];
    if (cb) {
        var result = new Array(len);
        for (var i = 0; i < len; i++) result[i] = HEAPF64[(arr >> 3) + i];
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

// ---- Gamepad bridge -------------------------------------------------

EMSCRIPTEN_KEEPALIVE
void ck_gamepad_connect(int gp_id, const char* name)
{
    CQ_PushCommand_G2A_GamepadConnect(gp_id, 1, name);
}

EMSCRIPTEN_KEEPALIVE
void ck_gamepad_disconnect(int gp_id)
{
    CQ_PushCommand_G2A_GamepadConnect(gp_id, 0, "");
}

EMSCRIPTEN_KEEPALIVE
void ck_gamepad_state(int gp_id, float* axes, int num_axes,
                      unsigned char* buttons, int num_buttons)
{
    GLFWgamepadstate state;
    memset(&state, 0, sizeof(state));
    int axesToCopy = num_axes < 6 ? num_axes : 6;
    for (int i = 0; i < axesToCopy; i++) state.axes[i] = axes[i];
    int btnsToCopy = num_buttons < 15 ? num_buttons : 15;
    for (int i = 0; i < btnsToCopy; i++) state.buttons[i] = buttons[i];
    CQ_PushCommand_G2A_GamepadState(gp_id, &state);
}

} // extern "C"
