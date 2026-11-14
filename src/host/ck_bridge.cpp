// Everything JS calls through Module.ccall, plus the callbacks that carry
// ChucK's asynchronous replies back out to the waiting JS promises.

#include "webchugl_internal.h"

#include "chuck_globals.h"
#include "chuck_errmsg.h"

#include <emscripten.h>
#include <dlfcn.h>
#include <stdio.h>
#include <string>
#include <vector>

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

// Signatures must match ck_get_id in chuck_globals.h.

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

// RFC 8259 §7: all of U+0000–U+001F must be escaped.
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

extern "C" {

// Each forwards to Chuck_Globals_Manager and returns 0 when no VM is up.
#define CK_GLOBAL(fn, params, call)                                                    \
    EMSCRIPTEN_KEEPALIVE                                                               \
    int fn params                                                                      \
    {                                                                                  \
        if (!the_chuck) return 0;                                                      \
        return the_chuck->vm()->globals_manager()->call;                               \
    }

CK_GLOBAL(ck_set_int, (const char* name, int val),
          setGlobalInt(name, (t_CKINT)val))

CK_GLOBAL(ck_set_float, (const char* name, double val),
          setGlobalFloat(name, (t_CKFLOAT)val))

CK_GLOBAL(ck_set_string, (const char* name, const char* val),
          setGlobalString(name, val))

CK_GLOBAL(ck_get_int, (const char* name, int callback_id),
          getGlobalInt(name, (t_CKINT)callback_id, _cb_get_int))

CK_GLOBAL(ck_get_float, (const char* name, int callback_id),
          getGlobalFloat(name, (t_CKINT)callback_id, _cb_get_float))

CK_GLOBAL(ck_get_string, (const char* name, int callback_id),
          getGlobalString(name, (t_CKINT)callback_id, _cb_get_string))

CK_GLOBAL(ck_signal_event, (const char* name),
          signalGlobalEvent(name))

CK_GLOBAL(ck_broadcast_event, (const char* name),
          broadcastGlobalEvent(name))

CK_GLOBAL(ck_listen_event, (const char* name, int callback_id, int listen_forever),
          listenForGlobalEvent(name, (t_CKINT)callback_id, _cb_event, (t_CKBOOL)listen_forever))

CK_GLOBAL(ck_stop_listening_event, (const char* name, int callback_id),
          stopListeningForGlobalEvent(name, (t_CKINT)callback_id, _cb_event))

CK_GLOBAL(ck_set_int_array, (const char* name, int* values, unsigned int len),
          setGlobalIntArray(name, (t_CKINT*)values, (t_CKUINT)len))

CK_GLOBAL(ck_get_int_array, (const char* name, int callback_id),
          getGlobalIntArray(name, (t_CKINT)callback_id, _cb_get_int_array))

CK_GLOBAL(ck_set_int_array_value, (const char* name, unsigned int index, int value),
          setGlobalIntArrayValue(name, (t_CKUINT)index, (t_CKINT)value))

CK_GLOBAL(ck_get_int_array_value, (const char* name, unsigned int index, int callback_id),
          getGlobalIntArrayValue(name, (t_CKINT)callback_id, (t_CKUINT)index, _cb_get_int))

CK_GLOBAL(ck_set_assoc_int_array_value, (const char* name, const char* key, int value),
          setGlobalAssociativeIntArrayValue(name, key, (t_CKINT)value))

CK_GLOBAL(ck_get_assoc_int_array_value, (const char* name, const char* key, int callback_id),
          getGlobalAssociativeIntArrayValue(name, (t_CKINT)callback_id, key, _cb_get_int))

CK_GLOBAL(ck_set_float_array, (const char* name, double* values, unsigned int len),
          setGlobalFloatArray(name, (t_CKFLOAT*)values, (t_CKUINT)len))

CK_GLOBAL(ck_get_float_array, (const char* name, int callback_id),
          getGlobalFloatArray(name, (t_CKINT)callback_id, _cb_get_float_array))

CK_GLOBAL(ck_set_float_array_value, (const char* name, unsigned int index, double value),
          setGlobalFloatArrayValue(name, (t_CKUINT)index, (t_CKFLOAT)value))

CK_GLOBAL(ck_get_float_array_value, (const char* name, unsigned int index, int callback_id),
          getGlobalFloatArrayValue(name, (t_CKINT)callback_id, (t_CKUINT)index, _cb_get_float))

CK_GLOBAL(ck_set_assoc_float_array_value, (const char* name, const char* key, double value),
          setGlobalAssociativeFloatArrayValue(name, key, (t_CKFLOAT)value))

CK_GLOBAL(ck_get_assoc_float_array_value, (const char* name, const char* key, int callback_id),
          getGlobalAssociativeFloatArrayValue(name, (t_CKINT)callback_id, key, _cb_get_float))

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

static t_CKUINT _find_last_shred_id()
{
    if (!the_chuck) return 0;
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

static int g_replaceOldShred = 0;
static int g_replaceNewShred = 0;

EMSCRIPTEN_KEEPALIVE
int ck_replace_code(const char* code)
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

EMSCRIPTEN_KEEPALIVE
const char* ck_get_loaded_chugins()
{
    static std::string result;
    result = "[";
    bool first = true;
    for (const auto& path : g_loadedChuginPaths) {
        if (!first) result += ",";
        first = false;
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

EMSCRIPTEN_KEEPALIVE
int ck_load_chugin(const char* vfsPath)
{
    if (!the_chuck) return 0;
    if (!vfsPath || vfsPath[0] == '\0') return 0;

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
