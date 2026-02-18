#!/bin/bash
# Build WebChuGL (WASM compilation only)
# Usage: ./build.sh [--clean] [-j N]
#
# This only compiles C++/WASM. To bundle code/packages into bundle.zip,
# run bundle.sh separately (or use build-and-bundle.sh for both).
#
# CMake builds in src/.cmake-build/ (outside build/) so that build/
# contains only web-deployable files.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$SRC_DIR/build"
CMAKE_BUILD_DIR="$SRC_DIR/.cmake-build"
PROJECT_ROOT="$(dirname "$SRC_DIR")"
EMSDK_DIR="$(ls -d "$PROJECT_ROOT"/emsdk-*/install/emscripten 2>/dev/null | head -1)"
if [ -z "$EMSDK_DIR" ] || [ ! -d "$EMSDK_DIR" ]; then
    echo "Error: Emscripten SDK not found. Run setup.sh first." >&2
    exit 1
fi

# Parse arguments
CLEAN=false
JOBS=8

while [[ $# -gt 0 ]]; do
    case $1 in
        --clean|-c)
            CLEAN=true
            shift
            ;;
        -j)
            JOBS="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: ./build.sh [--clean] [-j N]"
            exit 1
            ;;
    esac
done

PATCH_DIR="$PROJECT_ROOT/patches"

echo "=== Building WebChuGL ==="

# Check for emscripten
if [ ! -d "$EMSDK_DIR" ]; then
    echo "Error: Emscripten not found at $EMSDK_DIR"
    echo "Run ./setup.sh from the project root first."
    exit 1
fi

EMCMAKE="$EMSDK_DIR/emcmake"
EMMAKE="$EMSDK_DIR/emmake"

# Ensure emscripten-glfw patch is applied
GLFW_PATCH="$PATCH_DIR/emscripten-glfw.patch"
GLFW_JS_FILE="$EMSDK_DIR/cache/ports/contrib.glfw3/src/js/lib_emscripten_glfw3.js"
if [ -f "$GLFW_PATCH" ] && [ -f "$GLFW_JS_FILE" ]; then
    if ! grep -q "Re-register MQL with current DPR" "$GLFW_JS_FILE"; then
        echo "Applying emscripten-glfw patch..."
        cd "$EMSDK_DIR/cache/ports/contrib.glfw3"
        patch -p1 < "$GLFW_PATCH"
        cd "$SRC_DIR"
    fi
fi

# Clean if requested
if [ "$CLEAN" = true ]; then
    for d in "$BUILD_DIR" "$CMAKE_BUILD_DIR"; do
        [ -d "$d" ] && echo "Cleaning $d..." && rm -rf "$d"
    done
fi

# Create directories
mkdir -p "$BUILD_DIR" "$CMAKE_BUILD_DIR"

# Configure if needed
if [ ! -f "$CMAKE_BUILD_DIR/CMakeCache.txt" ]; then
    echo "Configuring with CMake..."
    cd "$CMAKE_BUILD_DIR"
    "$EMCMAKE" cmake "$SRC_DIR" -DCMAKE_POLICY_VERSION_MINIMUM="3.5"
    cd "$SRC_DIR"
fi

# Build
echo "Building WASM..."
cd "$CMAKE_BUILD_DIR"
"$EMMAKE" make -j "$JOBS"

# Copy web outputs to build/
echo "Copying web outputs..."
for f in index.html index.worker.js sw.js manifest.json; do
    [ -f "$CMAKE_BUILD_DIR/$f" ] && cp "$CMAKE_BUILD_DIR/$f" "$BUILD_DIR/$f"
done
if [ -d "$CMAKE_BUILD_DIR/webchugl" ]; then
    mkdir -p "$BUILD_DIR/webchugl"
    cp -r "$CMAKE_BUILD_DIR/webchugl/"* "$BUILD_DIR/webchugl/"
fi

# Minify JS assets
echo "Minifying JS..."
python3 "$SCRIPT_DIR/py/minify_js.py" "$BUILD_DIR/webchugl/webchugl.js"

echo ""
echo "=== Build Complete ==="
echo "Output: $BUILD_DIR"
echo "Next: ./scripts/bundle.sh (to create bundle.zip)"
