# WebChuGL Audio - ChucK + ChuGL for Audio Worklet
#
# Builds a WASM module that includes:
# - ChucK VM for audio processing
# - ChuGL scene graph API (generates commands)
# - Command queue that gets sent to main thread
#
# Does NOT include:
# - WebGPU rendering (handled by main thread)
# - GLFW/window management
#
# Build with:
#   mkdir build-audio && cd build-audio
#   emcmake cmake -f ../CMakeLists_audio.cmake .
#   emmake make -j8

cmake_minimum_required(VERSION 3.16)
project(WebChuGL_Audio LANGUAGES CXX C)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_EXTENSIONS OFF)

# Paths - relative to build-audio directory
set(HOST_WEB_DIR "${CMAKE_CURRENT_SOURCE_DIR}/..")
set(CHUCK_CORE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../chuck/src/core")
set(CHUGL_SRC_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../chugl/src")

# ===========================================================================
# ChucK core sources
# ===========================================================================
set(CHUCK_CORE_SOURCES
    ${CHUCK_CORE_DIR}/chuck.cpp
    ${CHUCK_CORE_DIR}/chuck_absyn.cpp
    ${CHUCK_CORE_DIR}/chuck_carrier.cpp
    ${CHUCK_CORE_DIR}/chuck_compile.cpp
    ${CHUCK_CORE_DIR}/chuck_dl.cpp
    ${CHUCK_CORE_DIR}/chuck_emit.cpp
    ${CHUCK_CORE_DIR}/chuck_errmsg.cpp
    ${CHUCK_CORE_DIR}/chuck_frame.cpp
    ${CHUCK_CORE_DIR}/chuck_globals.cpp
    ${CHUCK_CORE_DIR}/chuck_instr.cpp
    ${CHUCK_CORE_DIR}/chuck_io.cpp
    ${CHUCK_CORE_DIR}/chuck_lang.cpp
    ${CHUCK_CORE_DIR}/chuck_oo.cpp
    ${CHUCK_CORE_DIR}/chuck_parse.cpp
    ${CHUCK_CORE_DIR}/chuck_scan.cpp
    ${CHUCK_CORE_DIR}/chuck_stats.cpp
    ${CHUCK_CORE_DIR}/chuck_symbol.cpp
    ${CHUCK_CORE_DIR}/chuck_table.cpp
    ${CHUCK_CORE_DIR}/chuck_type.cpp
    ${CHUCK_CORE_DIR}/chuck_ugen.cpp
    ${CHUCK_CORE_DIR}/chuck_vm.cpp
    ${CHUCK_CORE_DIR}/chuck_yacc.c
    ${CHUCK_CORE_DIR}/uana_extract.cpp
    ${CHUCK_CORE_DIR}/uana_xform.cpp
    ${CHUCK_CORE_DIR}/ugen_filter.cpp
    ${CHUCK_CORE_DIR}/ugen_osc.cpp
    ${CHUCK_CORE_DIR}/ugen_stk.cpp
    ${CHUCK_CORE_DIR}/ugen_xxx.cpp
    ${CHUCK_CORE_DIR}/ulib_ai.cpp
    ${CHUCK_CORE_DIR}/ulib_doc.cpp
    ${CHUCK_CORE_DIR}/ulib_machine.cpp
    ${CHUCK_CORE_DIR}/ulib_math.cpp
    ${CHUCK_CORE_DIR}/ulib_std.cpp
    ${CHUCK_CORE_DIR}/util_buffers.cpp
    ${CHUCK_CORE_DIR}/util_console.cpp
    ${CHUCK_CORE_DIR}/util_math.cpp
    ${CHUCK_CORE_DIR}/util_platforms.cpp
    ${CHUCK_CORE_DIR}/util_raw.c
    ${CHUCK_CORE_DIR}/util_sndfile.c
    ${CHUCK_CORE_DIR}/util_string.cpp
    ${CHUCK_CORE_DIR}/util_thread.cpp
    ${CHUCK_CORE_DIR}/util_xforms.c
)

# ===========================================================================
# ChuGL core sources (audio-side only, no rendering)
# ===========================================================================
set(CHUGL_SOURCES
    # ChuGL entry point for audio worklet (unity build)
    ${CHUGL_SRC_DIR}/ChuGL.cpp
    # Core utilities
    ${CHUGL_SRC_DIR}/core/log.c
    ${CHUGL_SRC_DIR}/core/hashmap.c
    ${CHUGL_SRC_DIR}/core/memory.cpp
)

# ===========================================================================
# Audio entry point + ChuGL command queue interface
# ===========================================================================
set(AUDIO_SOURCES
    ${HOST_WEB_DIR}/webchugl_audio.cpp
    ${HOST_WEB_DIR}/webchugl_chugl_audio.cpp
    ${HOST_WEB_DIR}/webchugl_stubs.cpp  # Stubs for graphics functions
)

# ===========================================================================
# Target
# ===========================================================================
add_executable(webchugl_audio ${AUDIO_SOURCES} ${CHUCK_CORE_SOURCES} ${CHUGL_SOURCES})

# ===========================================================================
# Include directories
# ===========================================================================
target_include_directories(webchugl_audio PRIVATE
    ${CHUCK_CORE_DIR}
    ${CHUGL_SRC_DIR}
    ${CHUGL_SRC_DIR}/vendor
)

# ===========================================================================
# Compile definitions
# ===========================================================================
target_compile_definitions(webchugl_audio PRIVATE
    # Disable ChucK features not available on web
    __DISABLE_MIDI__
    __DISABLE_NETWORK__
    __DISABLE_SERIAL__
    __DISABLE_HID__
    __DISABLE_WATCHDOG__
    __DISABLE_KBHIT__
    __DISABLE_PROMPTER__
    __DISABLE_SHELL__
    __DISABLE_THREADS__
    __DISABLE_OTF_SERVER__
    __DISABLE_ASYNCH_IO__
    __ALTER_HID__
    __CHUCK_USE_PLANAR_BUFFERS__
    __OLDSCHOOL_RANDOM__
    __PLATFORM_EMSCRIPTEN__

    # ChuGL options - disable features not needed for audio worklet
    WEBCHUGL_NO_IMGUI
    WEBCHUGL_NO_VIDEO
    WEBCHUGL_NO_BOX2D
    CHUGL_FAST_COMPILE
    WEBCHUGL_AUDIO_ONLY  # Custom flag to disable rendering code

    # Graphics (still needed for types)
    GLM_FORCE_DEPTH_ZERO_TO_ONE
    GLM_ENABLE_EXPERIMENTAL
)

# ===========================================================================
# Compile options
# ===========================================================================
target_compile_options(webchugl_audio PRIVATE
    -sUSE_WEBGPU  # For webgpu.h types only
    -O2
    -Wno-unused-parameter
    -Wno-sign-compare
    -Wno-unused-function
    -Wno-unused-variable
    -Wno-deprecated-declarations
    -Wno-missing-field-initializers
    -Wno-unused-but-set-variable
    -Wno-unused-value
)

# ===========================================================================
# Emscripten link options for Audio Worklet
# ===========================================================================
target_link_options(webchugl_audio PRIVATE
    -sUSE_WEBGPU  # For webgpu.h types only
    -sALLOW_MEMORY_GROWTH
    -sALLOW_TABLE_GROWTH
    -sSTACK_SIZE=524288
    -sFORCE_FILESYSTEM=0
    -sDISABLE_EXCEPTION_CATCHING=0
    # Export functions for JavaScript
    -sEXPORTED_FUNCTIONS=['_malloc','_free','_initChuckInstance','_runChuckCode','_runChuckFile','_processChuckAudio','_getChuckNow','_setChuckInt','_setChuckFloat','_destroyChuckInstance','_main','_chugl_getCommandQueueBuffer','_chugl_getCommandQueueSize','_chugl_swapCommandQueues','_chugl_clearReadQueue','_chugl_init','_chugl_broadcastNextFrame','_chugl_isReady']
    -sEXPORTED_RUNTIME_METHODS=['cwrap','ccall']
    # Audio Worklet - single file with embedded WASM
    -sENVIRONMENT=web,worker
    -sSINGLE_FILE=1
    -sMODULARIZE=1
    -sEXPORT_NAME='createChuckModule'
    -sASSERTIONS=0
    -O2
    -sMINIFY_HTML=0
)

set_target_properties(webchugl_audio PROPERTIES
    SUFFIX ".js"
    OUTPUT_NAME "webchugl_audio"
)
