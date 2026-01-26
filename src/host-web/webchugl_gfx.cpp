/**
 * WebChuGL Graphics API for Audio Worklet
 *
 * Provides a simple graphics API that ChucK can call from the Audio Worklet.
 * Commands are sent to the main thread via JavaScript postMessage.
 */

#include <emscripten.h>
#include <emscripten/bind.h>
#include <cstdint>
#include <vector>
#include <string>

// Command buffer that JavaScript will read
static std::vector<uint8_t> g_commandBuffer;
static uint32_t g_nextObjectId = 1;
static bool g_frameRequested = false;

// Command types
enum CommandType : uint8_t {
    CMD_NONE = 0,
    CMD_CREATE_CIRCLE,
    CMD_CREATE_BOX,
    CMD_UPDATE_POSITION,
    CMD_UPDATE_SCALE,
    CMD_UPDATE_ROTATION,
    CMD_UPDATE_COLOR,
    CMD_SET_BACKGROUND,
    CMD_DELETE_OBJECT,
    CMD_CLEAR_SCENE,
};

// Helper to write to command buffer
template<typename T>
static void writeValue(const T& value) {
    const uint8_t* ptr = reinterpret_cast<const uint8_t*>(&value);
    g_commandBuffer.insert(g_commandBuffer.end(), ptr, ptr + sizeof(T));
}

static void writeString(const std::string& str) {
    uint32_t len = str.length();
    writeValue(len);
    g_commandBuffer.insert(g_commandBuffer.end(), str.begin(), str.end());
}

// ============================================================================
// C API (called from ChucK via cwrap)
// ============================================================================

extern "C" {

EMSCRIPTEN_KEEPALIVE
uint32_t gfx_createCircle(float x, float y, float radius, float r, float g, float b) {
    uint32_t id = g_nextObjectId++;
    writeValue(CMD_CREATE_CIRCLE);
    writeValue(id);
    writeValue(x);
    writeValue(y);
    writeValue(radius);
    writeValue(r);
    writeValue(g);
    writeValue(b);
    return id;
}

EMSCRIPTEN_KEEPALIVE
uint32_t gfx_createBox(float x, float y, float width, float height, float r, float g, float b) {
    uint32_t id = g_nextObjectId++;
    writeValue(CMD_CREATE_BOX);
    writeValue(id);
    writeValue(x);
    writeValue(y);
    writeValue(width);
    writeValue(height);
    writeValue(r);
    writeValue(g);
    writeValue(b);
    return id;
}

EMSCRIPTEN_KEEPALIVE
void gfx_setPosition(uint32_t id, float x, float y) {
    writeValue(CMD_UPDATE_POSITION);
    writeValue(id);
    writeValue(x);
    writeValue(y);
}

EMSCRIPTEN_KEEPALIVE
void gfx_setScale(uint32_t id, float sx, float sy) {
    writeValue(CMD_UPDATE_SCALE);
    writeValue(id);
    writeValue(sx);
    writeValue(sy);
}

EMSCRIPTEN_KEEPALIVE
void gfx_setRotation(uint32_t id, float angle) {
    writeValue(CMD_UPDATE_ROTATION);
    writeValue(id);
    writeValue(angle);
}

EMSCRIPTEN_KEEPALIVE
void gfx_setColor(uint32_t id, float r, float g, float b) {
    writeValue(CMD_UPDATE_COLOR);
    writeValue(id);
    writeValue(r);
    writeValue(g);
    writeValue(b);
}

EMSCRIPTEN_KEEPALIVE
void gfx_setBackground(float r, float g, float b) {
    writeValue(CMD_SET_BACKGROUND);
    writeValue(r);
    writeValue(g);
    writeValue(b);
}

EMSCRIPTEN_KEEPALIVE
void gfx_deleteObject(uint32_t id) {
    writeValue(CMD_DELETE_OBJECT);
    writeValue(id);
}

EMSCRIPTEN_KEEPALIVE
void gfx_clearScene() {
    writeValue(CMD_CLEAR_SCENE);
}

// Called by nextFrame() to get command buffer
EMSCRIPTEN_KEEPALIVE
uint8_t* gfx_getCommandBuffer() {
    return g_commandBuffer.data();
}

EMSCRIPTEN_KEEPALIVE
uint32_t gfx_getCommandBufferSize() {
    return g_commandBuffer.size();
}

EMSCRIPTEN_KEEPALIVE
void gfx_clearCommandBuffer() {
    g_commandBuffer.clear();
}

EMSCRIPTEN_KEEPALIVE
void gfx_requestFrame() {
    g_frameRequested = true;
}

EMSCRIPTEN_KEEPALIVE
bool gfx_isFrameRequested() {
    bool result = g_frameRequested;
    g_frameRequested = false;
    return result;
}

} // extern "C"
