/**
 * WebChuGL Audio Worklet Stubs
 *
 * Provides stub implementations for graphics functions that are referenced
 * by ChuGL ulib code but not needed in audio-only mode.
 * Commands are serialized to the command queue instead of being executed.
 */

#include <cstdint>
#include <cstddef>

// ============================================================================
// Graphics stubs (from graphics.cpp)
// ============================================================================

int G_mipLevels(int width, int height)
{
    // Calculate mip levels - simple implementation
    int levels = 1;
    while (width > 1 || height > 1) {
        width = width > 1 ? width / 2 : 1;
        height = height > 1 ? height / 2 : 1;
        levels++;
    }
    return levels;
}

// ============================================================================
// stb_image stubs (texture loading)
// ============================================================================

extern "C" {

unsigned char* stbi_load(const char* filename, int* x, int* y, int* comp, int req_comp)
{
    // In audio-only mode, texture loading is not supported
    // Return null to indicate failure
    if (x) *x = 0;
    if (y) *y = 0;
    if (comp) *comp = 0;
    return nullptr;
}

unsigned char* stbi_load_from_memory(const unsigned char* buffer, int len, int* x, int* y, int* comp, int req_comp)
{
    if (x) *x = 0;
    if (y) *y = 0;
    if (comp) *comp = 0;
    return nullptr;
}

int stbi_info(const char* filename, int* x, int* y, int* comp)
{
    if (x) *x = 0;
    if (y) *y = 0;
    if (comp) *comp = 0;
    return 0; // failure
}

int stbi_info_from_memory(const unsigned char* buffer, int len, int* x, int* y, int* comp)
{
    if (x) *x = 0;
    if (y) *y = 0;
    if (comp) *comp = 0;
    return 0;
}

const char* stbi_failure_reason()
{
    return "Texture loading not supported in audio worklet";
}

void stbi_image_free(void* retval_from_stbi_load)
{
    // No-op
}

} // extern "C"

// ============================================================================
// sokol_time stubs (timing)
// ============================================================================

extern "C" {

void stm_setup()
{
    // No-op
}

uint64_t stm_now()
{
    // Return 0 - timing not used in audio-only mode
    return 0;
}

uint64_t stm_laptime(uint64_t* last_time)
{
    if (last_time) *last_time = 0;
    return 0;
}

double stm_sec(uint64_t ticks)
{
    return 0.0;
}

double stm_ms(uint64_t ticks)
{
    return 0.0;
}

double stm_us(uint64_t ticks)
{
    return 0.0;
}

double stm_ns(uint64_t ticks)
{
    return 0.0;
}

} // extern "C"
