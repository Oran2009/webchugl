#!/bin/bash
# Build WebChuGL
# Usage: ./build.sh [--clean] [-j N]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$SRC_DIR/build"
PROJECT_ROOT="$(dirname "$SRC_DIR")"
EMSDK_DIR="$PROJECT_ROOT/emsdk-3.1.61/install/emscripten"

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

echo "=== Building WebChuGL ==="

# Check for emscripten
if [ ! -d "$EMSDK_DIR" ]; then
    echo "Error: Emscripten not found at $EMSDK_DIR"
    echo "Run ./setup.sh from the project root first."
    exit 1
fi

EMCMAKE="$EMSDK_DIR/emcmake"
EMMAKE="$EMSDK_DIR/emmake"

# Clean if requested
if [ "$CLEAN" = true ] && [ -d "$BUILD_DIR" ]; then
    echo "Cleaning build directory..."
    rm -rf "$BUILD_DIR"
fi

# Create build directory
mkdir -p "$BUILD_DIR"

# Configure if needed
if [ ! -f "$BUILD_DIR/CMakeCache.txt" ]; then
    echo "Configuring with CMake..."
    cd "$BUILD_DIR"
    "$EMCMAKE" cmake ..
    cd "$SRC_DIR"
fi

# Copy all files from code directory to build directory (before build so they're available)
CODE_DIR="$SRC_DIR/code"
if [ -d "$CODE_DIR" ]; then
    cp -r "$CODE_DIR"/* "$BUILD_DIR/"
    echo "Copied code/ to build directory"

    # Generate manifest.json listing all files from code/
    cd "$CODE_DIR"
    FILES=$(find . -type f | sed 's|^\./||' | sort)
    cd "$BUILD_DIR"
    echo "{\"files\":[" > manifest.json
    first=true
    for f in $FILES; do
        if [ "$first" = true ]; then
            first=false
        else
            echo "," >> manifest.json
        fi
        echo -n "\"$f\"" >> manifest.json
    done
    echo "]}" >> manifest.json
    echo "Generated manifest.json"
    cd "$SRC_DIR"
fi

# Build
echo "Building WASM..."
cd "$BUILD_DIR"
"$EMMAKE" make -j "$JOBS"

echo ""
echo "=== Build Complete ==="
echo "Output: $BUILD_DIR/index.html"
echo "To test: python scripts/serve.py"
