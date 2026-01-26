/**
 * WebChuGL ChuGL Audio Worklet Entry Point
 *
 * This file provides ChuGL support for the Audio Worklet build.
 * It exposes the command queue to JavaScript for sending to the main thread.
 *
 * The main ChuGL.cpp is built separately and includes all the ChucK bindings.
 * This file just provides the C exports for JavaScript to access the command queue.
 */

#include <emscripten.h>

// Include ChuGL headers in proper order
#include "chugl_defines.h"
#include "geometry.h"
#include "sg_command.h"

// Include chugin.h for Chuck types (CK_DL_API, Chuck_VM)
#include <chuck/chugin.h>

// Wrapper function to broadcast NextFrameEvent (implemented in sync.cpp)
// This avoids redeclaring the CHUGL_EventType enum
void ChuGL_BroadcastNextFrame();

// External references to ChuGL globals (defined in ulib_helper.h, set by ChuGL.cpp)
extern Chuck_VM* g_chuglVM;
extern CK_DL_API g_chuglAPI;

// ============================================================================
// JavaScript Interface for Command Queue
// ============================================================================

extern "C" {

/**
 * Get pointer to command queue write buffer
 */
EMSCRIPTEN_KEEPALIVE
void* chugl_getCommandQueueBuffer() {
    return CQ_GetWriteQueueBase(false);  // false = audio_to_graphics queue
}

/**
 * Get current size of command queue (bytes written)
 */
EMSCRIPTEN_KEEPALIVE
size_t chugl_getCommandQueueSize() {
    return CQ_GetWriteQueueSize(false);  // false = audio_to_graphics queue
}

/**
 * Swap command queues (called after sending commands to main thread)
 */
EMSCRIPTEN_KEEPALIVE
void chugl_swapCommandQueues() {
    CQ_SwapQueues(false);  // false = audio_to_graphics queue
}

/**
 * Clear the read queue after processing
 */
EMSCRIPTEN_KEEPALIVE
void chugl_clearReadQueue() {
    CQ_ReadCommandQueueClear(false);  // false = audio_to_graphics queue
}

/**
 * Initialize ChuGL (command queue is initialized by ChuGL.cpp's CK_DLL_QUERY)
 * This is a stub for JavaScript compatibility
 */
EMSCRIPTEN_KEEPALIVE
void chugl_init() {
    // CQ_Init() and SG_Init() are called by ChuGL.cpp's CK_DLL_QUERY
    // This function exists for JavaScript interface compatibility
}

/**
 * Broadcast the NextFrameEvent to wake up shreds waiting on GG.nextFrame() => now
 * This must be called periodically to advance the graphics frame.
 *
 * Flow:
 * 1. Shreds run and call GG.nextFrame() => now, blocking
 * 2. Call chugl_broadcastNextFrame() to wake them up
 * 3. Shreds execute animation code, generating ChuGL commands
 * 4. Shreds call GG.nextFrame() => now again and block
 * 5. Get commands with chugl_getCommandQueueBuffer/Size
 * 6. Send commands to main thread
 * 7. Call chugl_swapCommandQueues() to swap buffers
 * 8. Repeat from step 2
 */
EMSCRIPTEN_KEEPALIVE
void chugl_broadcastNextFrame() {
    ChuGL_BroadcastNextFrame();
}

/**
 * Check if ChuGL is ready (g_chuglAPI and g_chuglVM are set)
 */
EMSCRIPTEN_KEEPALIVE
int chugl_isReady() {
    return (g_chuglAPI && g_chuglVM) ? 1 : 0;
}

} // extern "C"
