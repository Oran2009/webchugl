cmake_minimum_required(VERSION 3.16)
project(WebChuGL LANGUAGES CXX C)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_EXTENSIONS OFF)

# Paths
set(CHUCK_CORE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../chuck/src/core")
set(CHUGL_SRC_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../chugl/src")

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
    # Excluded for web: chuck_otf network deps handled by __DISABLE_OTF_SERVER__
    # Excluded: midiio_rtmidi.cpp, rtmidi.cpp, hidio_sdl.cpp (platform-specific)
    # Excluded: util_network.c, util_opsc.cpp, ulib_opsc.cpp (network)
    # Excluded: util_serial.cpp (serial), util_hid.cpp (HID)
)

# ===========================================================================
# ChuGL sources (unity build)
# ===========================================================================
set(CHUGL_SOURCES
    ${CHUGL_SRC_DIR}/ChuGL.cpp
    ${CHUGL_SRC_DIR}/core/log.c
    ${CHUGL_SRC_DIR}/core/hashmap.c
    ${CHUGL_SRC_DIR}/core/memory.cpp
    ${CHUGL_SRC_DIR}/implementations.cpp
    # GLFW3WebGPU bridge (compiled directly, not as subdirectory)
    ${CHUGL_SRC_DIR}/vendor/glfw3webgpu/glfw3webgpu.c
    # Dear ImGui + cimgui C wrapper
    ${CHUGL_SRC_DIR}/vendor/cimgui/cimgui.cpp
    ${CHUGL_SRC_DIR}/vendor/cimgui/imgui/imgui.cpp
    ${CHUGL_SRC_DIR}/vendor/cimgui/imgui/imgui_demo.cpp
    ${CHUGL_SRC_DIR}/vendor/cimgui/imgui/imgui_draw.cpp
    ${CHUGL_SRC_DIR}/vendor/cimgui/imgui/imgui_tables.cpp
    ${CHUGL_SRC_DIR}/vendor/cimgui/imgui/imgui_widgets.cpp
    ${CHUGL_SRC_DIR}/vendor/cimgui/imgui/backends/imgui_impl_glfw.cpp
    ${CHUGL_SRC_DIR}/vendor/cimgui/imgui/backends/imgui_impl_wgpu.cpp
)

# ===========================================================================
# Host entry point
# ===========================================================================
set(HOST_SOURCES
    ${CMAKE_CURRENT_SOURCE_DIR}/webchugl_main.cpp
)

# ===========================================================================
# Target
# ===========================================================================
add_executable(webchugl ${HOST_SOURCES} ${CHUCK_CORE_SOURCES} ${CHUGL_SOURCES})

# ===========================================================================
# Include directories
# ===========================================================================
target_include_directories(webchugl PRIVATE
    ${CHUCK_CORE_DIR}
    ${CHUGL_SRC_DIR}
    ${CHUGL_SRC_DIR}/vendor
    ${CHUGL_SRC_DIR}/vendor/glfw3webgpu
    ${CHUGL_SRC_DIR}/vendor/cimgui
    ${CHUGL_SRC_DIR}/vendor/cimgui/imgui
)

# ===========================================================================
# Compile definitions
# ===========================================================================
target_compile_definitions(webchugl PRIVATE
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

    # ChuGL options
    WEBCHUGL_NO_VIDEO
    WEBCHUGL_NO_BOX2D
    CHUGL_FAST_COMPILE

    # Graphics
    GLM_FORCE_DEPTH_ZERO_TO_ONE
    GLM_ENABLE_EXPERIMENTAL
)

# ===========================================================================
# Compile options
# ===========================================================================
target_compile_options(webchugl PRIVATE
    -sUSE_WEBGPU
    -sUSE_GLFW=3
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
# Dependencies (FetchContent)
# ===========================================================================
include(FetchContent)

# FreeType font rendering
set(FT_DISABLE_BROTLI   ON  CACHE BOOL "" FORCE)
set(FT_DISABLE_BZIP2    ON  CACHE BOOL "" FORCE)
set(FT_DISABLE_HARFBUZZ ON  CACHE BOOL "" FORCE)
set(FT_DISABLE_PNG      ON  CACHE BOOL "" FORCE)
set(FT_DISABLE_ZLIB     ON  CACHE BOOL "" FORCE)
set(FT_ENABLE_ERROR_STRINGS ON CACHE BOOL "" FORCE)
add_subdirectory(${CHUGL_SRC_DIR}/vendor/freetype freetype_build)

target_link_libraries(webchugl PRIVATE freetype)

# ===========================================================================
# Emscripten link options
# ===========================================================================
target_link_options(webchugl PRIVATE
    -sUSE_WEBGPU
    -sUSE_GLFW=3
    -sALLOW_MEMORY_GROWTH
    -sALLOW_TABLE_GROWTH
    -sSTACK_SIZE=1048576
    -sASYNCIFY
    -sASYNCIFY_STACK_SIZE=32768
    # Exclude large modules that don't need async support (reduces code bloat significantly)
    "-sASYNCIFY_REMOVE=['ImGui*','ImDraw*','ImFont*','ImPool*','ImVector*','ImGui_Impl*','chuck_*','Chuck_*','uana_*','ugen_*','ulib_*','FT_*','ft_*','stb_*','par_*','glm::*']"
    -sFORCE_FILESYSTEM
    -sDISABLE_EXCEPTION_CATCHING=0
    -sEXPORTED_FUNCTIONS=['_main','_malloc','_free']
    -sEXPORTED_RUNTIME_METHODS=['ccall','cwrap']
    -sENVIRONMENT=web
    -sASSERTIONS=1
    -O2
    -sMINIFY_HTML=0
    --shell-file=${CMAKE_CURRENT_SOURCE_DIR}/web/shell.html
)

set_target_properties(webchugl PROPERTIES
    SUFFIX ".html"
    OUTPUT_NAME "index"
)
