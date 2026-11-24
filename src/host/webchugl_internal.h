#pragma once

// State and hooks shared between webchugl_main.cpp and ck_bridge.cpp.

#include "chuck.h"

#include <list>
#include <string>

extern ChucK* the_chuck;
extern std::list<void*> g_chuginHandles;
extern std::list<std::string> g_loadedChuginPaths;

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

// Canvas sizing (canvas.cpp)
extern "C" void chugl_fit_canvas(double aspect_x, double aspect_y);
