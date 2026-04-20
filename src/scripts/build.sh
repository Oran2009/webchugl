#!/bin/bash
# Build WebChuGL (WASM compilation)
# Usage: ./build.sh [--clean] [-j N]
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

echo "=== Building WebChuGL ==="

EMCMAKE="$EMSDK_DIR/emcmake.py"
EMMAKE="$EMSDK_DIR/emmake.py"

# Compile TypeScript
echo "Compiling TypeScript..."
(cd "$PROJECT_ROOT" && npx tsc)
echo "Generating ESM declarations..."
(cd "$PROJECT_ROOT" && npx tsc -p tsconfig.esm-declarations.json)
echo "Bundling webchugl.js..."
(cd "$PROJECT_ROOT" && npx esbuild src/web/webchugl.ts --bundle --format=iife --outfile=src/web/webchugl.js --sourcemap)

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
    (cd "$CMAKE_BUILD_DIR" && "$EMCMAKE" cmake "$SRC_DIR" -DCMAKE_POLICY_VERSION_MINIMUM="3.5" -DCMAKE_BUILD_TYPE=Release)
fi

# Build
echo "Building WASM..."
(cd "$CMAKE_BUILD_DIR" && "$EMMAKE" make -j "$JOBS")

# Copy web outputs to build/
echo "Copying web outputs..."
for f in index.html sw.js manifest.json; do
    [ -f "$CMAKE_BUILD_DIR/$f" ] && cp "$CMAKE_BUILD_DIR/$f" "$BUILD_DIR/$f"
done
if [ -d "$CMAKE_BUILD_DIR/webchugl" ]; then
    mkdir -p "$BUILD_DIR/webchugl"
    cp -r "$CMAKE_BUILD_DIR/webchugl/"* "$BUILD_DIR/webchugl/"
fi

# Validate required build outputs exist
if [ ! -f "$BUILD_DIR/webchugl/index.js" ] || [ ! -f "$BUILD_DIR/webchugl/webchugl.wasm" ]; then
    echo "ERROR: Build outputs missing. Expected webchugl/index.js and webchugl/webchugl.wasm in $BUILD_DIR" >&2
    exit 1
fi

# Copy runtime to dist/ (for npm publishing — includes all assets)
echo "Preparing npm dist..."
DIST_DIR="$PROJECT_ROOT/dist"
mkdir -p "$DIST_DIR"
for f in index.js webchugl.wasm webchugl.js \
         audio-worklet-processor.js jszip.min.js; do
    [ -f "$BUILD_DIR/webchugl/$f" ] && cp "$BUILD_DIR/webchugl/$f" "$DIST_DIR/$f"
done
cp "$SRC_DIR/web/webchugl-esm.js" "$DIST_DIR/webchugl-esm.js"
# Copy TypeScript declaration files for npm consumers
[ -f "$SRC_DIR/web/webchugl-esm.d.ts" ] && cp "$SRC_DIR/web/webchugl-esm.d.ts" "$DIST_DIR/webchugl-esm.d.ts"
if [ -f "$SRC_DIR/web/types/chuck.d.ts" ]; then
    mkdir -p "$DIST_DIR/types"
    cp "$SRC_DIR/web/types/chuck.d.ts" "$DIST_DIR/types/chuck.d.ts"
fi

# Inject package version into ESM (replaces __WEBCHUGL_VERSION__ placeholder)
PKG_VERSION=$(node -p "require('$PROJECT_ROOT/package.json').version")
sed -i "s/__WEBCHUGL_VERSION__/$PKG_VERSION/g" "$DIST_DIR/webchugl-esm.js"
echo "Injected version $PKG_VERSION into webchugl-esm.js"

echo ""
echo "=== Build Complete ==="
echo "Output: $BUILD_DIR"
