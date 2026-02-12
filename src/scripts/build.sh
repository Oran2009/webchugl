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

# Copy code directory to build/code/ (preserving structure for /code/main.ck path)
CODE_DIR="$SRC_DIR/code"
BUILD_CODE_DIR="$BUILD_DIR/code"
if [ -d "$CODE_DIR" ]; then
    rm -rf "$BUILD_CODE_DIR"
    cp -r "$CODE_DIR" "$BUILD_CODE_DIR"
    echo "Copied code/ to build/code/"
fi

# Fetch ChuMP packages if packages.json exists
PACKAGES_JSON="$CODE_DIR/packages.json"
BUILD_PACKAGES_DIR="$BUILD_DIR/packages"
if [ -f "$PACKAGES_JSON" ]; then
    echo "Fetching ChuMP packages..."
    python3 "$SCRIPT_DIR/fetch_packages.py" "$PACKAGES_JSON" "$BUILD_PACKAGES_DIR"
fi

# Create bundle.zip containing code/ and packages/ directories
echo "Creating bundle.zip..."
python3 "$SCRIPT_DIR/create_bundle.py" "$BUILD_DIR"

# Build
echo "Building WASM..."
cd "$BUILD_DIR"
"$EMMAKE" make -j "$JOBS"

# Minify JS assets
echo "Minifying JS..."
python3 "$SCRIPT_DIR/minify_js.py" "$BUILD_DIR/webchugl.js"

# Clean up build artifacts (keep only files needed for web serving)
echo "Cleaning build directory..."
cd "$BUILD_DIR"
# Remove CMake/Make build artifacts
rm -rf CMakeFiles cmake_install.cmake CMakeCache.txt Makefile freetype_build .ninja_deps .ninja_log build.ninja CPackConfig.cmake CPackSourceConfig.cmake
# Remove source directories already bundled in bundle.zip
rm -rf code packages

echo ""
echo "=== Build Complete ==="
echo "Output: $BUILD_DIR/index.html"
echo "To test: python scripts/serve.py"
echo "To develop: ./scripts/dev.sh"
