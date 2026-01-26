/**
 * WebChuGL Audio - ChucK VM for Audio Worklet
 *
 * This module runs in the Audio Worklet thread and provides:
 * - ChucK VM initialization and control
 * - Audio sample generation
 * - ChuGL command generation (sent to main thread)
 */

#include <emscripten.h>
#include <emscripten/bind.h>

#include "chuck.h"
#include "chuck_dl.h"

// ChuGL query function (defined via CK_DLL_QUERY macro in ChuGL.cpp)
// This registers all ChuGL types (GGen, GCircle, etc.) with ChucK
extern "C" t_CKBOOL ck_query(Chuck_DL_Query* QUERY);

// Global ChucK instances (keyed by ID)
#include <map>
static std::map<int, ChucK*> g_chucks;

// Audio output buffer
static SAMPLE* g_outputBuffer = nullptr;
static int g_outputBufferSize = 0;

extern "C" {

/**
 * Initialize a ChucK instance
 * @param chuckID Unique identifier for this instance
 * @param sampleRate Audio sample rate (e.g., 48000)
 * @param numChannels Number of output channels (1 or 2)
 * @return chuckID on success, 0 on failure
 */
EMSCRIPTEN_KEEPALIVE
int initChuckInstance(int chuckID, int sampleRate, int numChannels) {
    if (g_chucks.count(chuckID)) {
        // Already exists
        return 0;
    }

    ChucK* chuck = new ChucK();

    // Configure ChucK
    chuck->setParam(CHUCK_PARAM_SAMPLE_RATE, sampleRate);
    chuck->setParam(CHUCK_PARAM_INPUT_CHANNELS, 0);
    chuck->setParam(CHUCK_PARAM_OUTPUT_CHANNELS, numChannels);
    chuck->setParam(CHUCK_PARAM_VM_ADAPTIVE, 0);
    chuck->setParam(CHUCK_PARAM_VM_HALT, FALSE);
    chuck->setParam(CHUCK_PARAM_DUMP_INSTRUCTIONS, FALSE);

    // Initialize
    if (!chuck->init()) {
        delete chuck;
        return 0;
    }

    // Load ChuGL module (registers GGen, GCircle, GG, etc.)
    if (!chuck->compiler()->bind(ck_query, "ChuGL", "global")) {
        delete chuck;
        return 0;
    }

    // Start VM
    if (!chuck->start()) {
        delete chuck;
        return 0;
    }

    g_chucks[chuckID] = chuck;
    return chuckID;
}

/**
 * Run ChucK code on an instance
 * @param chuckID Instance identifier
 * @param code ChucK source code
 * @return Shred ID on success, 0 on failure
 */
EMSCRIPTEN_KEEPALIVE
int runChuckCode(int chuckID, const char* code) {
    auto it = g_chucks.find(chuckID);
    if (it == g_chucks.end()) {
        return 0;
    }

    ChucK* chuck = it->second;
    return chuck->compileCode(std::string(code), "", 1, TRUE) ? 1 : 0;
}

/**
 * Run ChucK file on an instance
 * @param chuckID Instance identifier
 * @param filename Path to .ck file (in virtual filesystem)
 * @return Shred ID on success, 0 on failure
 */
EMSCRIPTEN_KEEPALIVE
int runChuckFile(int chuckID, const char* filename) {
    auto it = g_chucks.find(chuckID);
    if (it == g_chucks.end()) {
        return 0;
    }

    ChucK* chuck = it->second;
    return chuck->compileFile(std::string(filename), "", 1, TRUE) ? 1 : 0;
}

/**
 * Process audio samples
 * @param chuckID Instance identifier
 * @param inBuffer Input buffer (can be null)
 * @param outBuffer Output buffer (interleaved)
 * @param numFrames Number of sample frames
 * @param numChannels Number of channels
 */
EMSCRIPTEN_KEEPALIVE
void processChuckAudio(int chuckID, float* inBuffer, float* outBuffer,
                       int numFrames, int numChannels) {
    auto it = g_chucks.find(chuckID);
    if (it == g_chucks.end()) {
        // Fill with silence
        for (int i = 0; i < numFrames * numChannels; i++) {
            outBuffer[i] = 0.0f;
        }
        return;
    }

    ChucK* chuck = it->second;

    // Ensure internal buffer is large enough
    int requiredSize = numFrames * numChannels;
    if (g_outputBufferSize < requiredSize) {
        delete[] g_outputBuffer;
        g_outputBuffer = new SAMPLE[requiredSize];
        g_outputBufferSize = requiredSize;
    }

    // Run ChucK VM - this advances time and generates samples
    chuck->run(inBuffer, g_outputBuffer, numFrames);

    // Copy to output buffer (SAMPLE might be double, outBuffer is float)
    for (int i = 0; i < requiredSize; i++) {
        outBuffer[i] = (float)g_outputBuffer[i];
    }
}

/**
 * Get current ChucK time (in samples)
 * @param chuckID Instance identifier
 * @return Current time in samples
 */
EMSCRIPTEN_KEEPALIVE
double getChuckNow(int chuckID) {
    auto it = g_chucks.find(chuckID);
    if (it == g_chucks.end()) {
        return 0.0;
    }
    return (double)it->second->vm()->now();
}

/**
 * Set global int variable
 * TODO: Implement using chuck_globals API
 */
EMSCRIPTEN_KEEPALIVE
int setChuckInt(int chuckID, const char* name, int value) {
    auto it = g_chucks.find(chuckID);
    if (it == g_chucks.end()) {
        return 0;
    }
    // Global variable API requires callback mechanism
    // For now, return success (stub)
    return 1;
}

/**
 * Set global float variable
 * TODO: Implement using chuck_globals API
 */
EMSCRIPTEN_KEEPALIVE
int setChuckFloat(int chuckID, const char* name, double value) {
    auto it = g_chucks.find(chuckID);
    if (it == g_chucks.end()) {
        return 0;
    }
    // Global variable API requires callback mechanism
    // For now, return success (stub)
    return 1;
}

/**
 * Get global int variable
 * TODO: Implement using chuck_globals API
 */
EMSCRIPTEN_KEEPALIVE
int getChuckInt(int chuckID, const char* name) {
    auto it = g_chucks.find(chuckID);
    if (it == g_chucks.end()) {
        return 0;
    }
    // Global variable API requires callback mechanism
    return 0;
}

/**
 * Destroy ChucK instance
 */
EMSCRIPTEN_KEEPALIVE
void destroyChuckInstance(int chuckID) {
    auto it = g_chucks.find(chuckID);
    if (it != g_chucks.end()) {
        delete it->second;
        g_chucks.erase(it);
    }
}

} // extern "C"

// Main entry point (not used in Audio Worklet, but required by Emscripten)
int main() {
    return 0;
}
