/**
 * WebChuGL Command Receiver
 *
 * Provides JavaScript interface for receiving ChuGL commands from Audio Worklet.
 * Commands are injected into the read queue for the renderer to process.
 */

#include <emscripten.h>
#include <cstring>

// ChuGL command queue functions (from sg_command.cpp)
extern void CQ_InjectCommandBytes(void* data, size_t size, bool which);
extern void* CQ_GetReadQueueBuffer(bool which);
extern void CQ_SetReadQueueSize(size_t size, bool which);
extern void CQ_ReadCommandQueueClear(bool which);

extern "C" {

/**
 * Get pointer to read queue buffer for JavaScript to write commands into
 * @return Pointer to the read queue buffer
 */
EMSCRIPTEN_KEEPALIVE
void* webchugl_getCommandBuffer() {
    return CQ_GetReadQueueBuffer(false);  // false = audio_to_graphics queue
}

/**
 * Set the size of command data written to the read queue
 * Call this after writing command bytes to the buffer
 * @param size Number of bytes written
 */
EMSCRIPTEN_KEEPALIVE
void webchugl_setCommandBufferSize(size_t size) {
    CQ_SetReadQueueSize(size, false);
}

/**
 * Inject command bytes directly (copies data)
 * Alternative to getCommandBuffer + setCommandBufferSize
 * @param data Pointer to command data
 * @param size Size of command data in bytes
 */
EMSCRIPTEN_KEEPALIVE
void webchugl_injectCommands(void* data, size_t size) {
    CQ_InjectCommandBytes(data, size, false);
}

/**
 * Clear the command queue after processing
 */
EMSCRIPTEN_KEEPALIVE
void webchugl_clearCommands() {
    CQ_ReadCommandQueueClear(false);
}

} // extern "C"
