#!/bin/bash
# WebChuGL Setup Script
# Clones dependencies, installs Emscripten SDK, and applies patches
#
# Usage: ./setup.sh

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

# Dependency versions
CHUGL_REPO="https://github.com/Oran2009/chugl.git"
CHUGL_BRANCH="webchugl"

CHUCK_REPO="https://github.com/ccrma/chuck.git"
CHUCK_COMMIT="60caede9"  # short SHA; git checkout handles prefix matching

EMSDK_VERSION="4.0.17"
# Pin emsdk orchestration scripts to a known commit for reproducibility
EMSDK_COMMIT="bb1c0642e7df86a7dee5abe8a0a98ac16ae9fd02"

echo "=== WebChuGL Setup ==="
echo ""

# ============================================================================
# Clone chugl
# ============================================================================
CHUGL_DIR="$PROJECT_ROOT/chugl"
if [ -d "$CHUGL_DIR" ]; then
    echo "[chugl] Directory exists, checking branch..."
    cd "$CHUGL_DIR"
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    if [ "$CURRENT_BRANCH" != "$CHUGL_BRANCH" ]; then
        echo "[chugl] Warning: Current branch ($CURRENT_BRANCH) differs from expected ($CHUGL_BRANCH)"
        echo "[chugl] You may need to: git checkout $CHUGL_BRANCH"
    else
        echo "[chugl] Already on branch $CHUGL_BRANCH"
    fi
    cd "$PROJECT_ROOT"
else
    echo "[chugl] Cloning from $CHUGL_REPO (branch: $CHUGL_BRANCH)..."
    git clone --filter=blob:none -b "$CHUGL_BRANCH" "$CHUGL_REPO" "$CHUGL_DIR"
    echo "[chugl] Cloned branch $CHUGL_BRANCH"
fi

# ============================================================================
# Clone chuck
# ============================================================================
CHUCK_DIR="$PROJECT_ROOT/chuck"
if [ -d "$CHUCK_DIR" ]; then
    echo "[chuck] Directory exists, checking commit..."
    cd "$CHUCK_DIR"
    CURRENT_COMMIT=$(git rev-parse --short=8 HEAD)
    if [ "$CURRENT_COMMIT" != "${CHUCK_COMMIT:0:8}" ]; then
        echo "[chuck] Warning: Current commit ($CURRENT_COMMIT) differs from expected ($CHUCK_COMMIT)"
        echo "[chuck] You may need to: git checkout $CHUCK_COMMIT"
    else
        echo "[chuck] Already at correct commit"
    fi
    cd "$PROJECT_ROOT"
else
    echo "[chuck] Cloning from $CHUCK_REPO..."
    git clone --filter=blob:none "$CHUCK_REPO" "$CHUCK_DIR"
    cd "$CHUCK_DIR"
    git checkout "$CHUCK_COMMIT"
    cd "$PROJECT_ROOT"
    echo "[chuck] Cloned and checked out $CHUCK_COMMIT"
fi

# ============================================================================
# Install Emscripten SDK
# ============================================================================
EMSDK_DIR="$PROJECT_ROOT/emsdk-$EMSDK_VERSION"
EMSDK_INSTALL="$EMSDK_DIR/install/emscripten"

if [ -d "$EMSDK_INSTALL" ]; then
    echo "[emsdk] Emscripten $EMSDK_VERSION already installed"
else
    echo ""
    echo "=== Installing Emscripten SDK $EMSDK_VERSION ==="

    # Clone emsdk if needed (pinned to known commit for reproducibility)
    if [ ! -d "$EMSDK_DIR" ]; then
        echo "[emsdk] Cloning emsdk..."
        git clone --filter=blob:none https://github.com/emscripten-core/emsdk.git "$EMSDK_DIR"
        cd "$EMSDK_DIR"
        git checkout "$EMSDK_COMMIT"
        cd "$PROJECT_ROOT"
    fi

    cd "$EMSDK_DIR"

    echo "[emsdk] Installing version $EMSDK_VERSION..."
    ./emsdk install "$EMSDK_VERSION"

    echo "[emsdk] Activating version $EMSDK_VERSION..."
    ./emsdk activate "$EMSDK_VERSION"

    # Move to install subdirectory for cleaner structure
    mkdir -p install
    if [ -d "upstream/emscripten" ]; then
        mv upstream/emscripten install/
        echo "[emsdk] Moved emscripten to install/"
    fi

    cd "$PROJECT_ROOT"
    echo "[emsdk] Emscripten $EMSDK_VERSION installed successfully"
fi

# ============================================================================
# Apply patches
# ============================================================================
PATCH_DIR="$PROJECT_ROOT/patches"

echo ""
echo "=== Applying Patches ==="

# Apply emscripten-glfw patch (contrib.glfw3 port)
GLFW_PATCH="$PATCH_DIR/emscripten-glfw.patch"
GLFW_PORT_DIR="$EMSDK_INSTALL/cache/ports/contrib.glfw3"
if [ -f "$GLFW_PATCH" ]; then
    # Pre-fetch the port if not already cached (use curl to avoid potential SSL issues)
    if [ ! -d "$GLFW_PORT_DIR" ]; then
        GLFW_PORT_URL="https://github.com/pongasoft/emscripten-glfw/releases/download/v3.4.0.20250927/emscripten-glfw3-3.4.0.20250927.zip"
        GLFW_PORT_ZIP="$EMSDK_INSTALL/cache/ports/contrib.glfw3.zip"
        CACHE_PORTS_DIR="$EMSDK_INSTALL/cache/ports"

        echo "[emscripten-glfw] Downloading contrib.glfw3 port..."
        mkdir -p "$CACHE_PORTS_DIR"
        curl -L --fail -o "$GLFW_PORT_ZIP" "$GLFW_PORT_URL"

        # Verify download integrity
        GLFW_EXPECTED_SHA256="c0d3fc0b0e4fea44c72e2e5a657c55924c68b60d2e984b8b3e82f42914ba0980"
        GLFW_ACTUAL_SHA256="$(sha256sum "$GLFW_PORT_ZIP" | cut -d' ' -f1)"
        if [ "$GLFW_ACTUAL_SHA256" != "$GLFW_EXPECTED_SHA256" ]; then
            echo "[emscripten-glfw] WARNING: SHA-256 mismatch for contrib.glfw3 port download"
            echo "  Expected: $GLFW_EXPECTED_SHA256"
            echo "  Got:      $GLFW_ACTUAL_SHA256"
            echo "  If this is a new version, update GLFW_EXPECTED_SHA256 in setup.sh"
        fi

        echo "[emscripten-glfw] Extracting..."
        mkdir -p "$GLFW_PORT_DIR"
        unzip -q -o "$GLFW_PORT_ZIP" -d "$GLFW_PORT_DIR"
        printf '%s' "$GLFW_PORT_URL" > "$GLFW_PORT_DIR/.emscripten_url"
        echo "[emscripten-glfw] Port cached successfully"
    fi

    if [ -d "$GLFW_PORT_DIR" ]; then
        GLFW_JS_FILE="$GLFW_PORT_DIR/src/js/lib_emscripten_glfw3.js"
        if [ -f "$GLFW_JS_FILE" ] && ! grep -q "Re-register MQL with current DPR" "$GLFW_JS_FILE"; then
            echo "[emscripten-glfw] Applying patch..."
            (cd "$GLFW_PORT_DIR" && patch -p1 < "$GLFW_PATCH")
            echo "[emscripten-glfw] Patch applied successfully"
        else
            echo "[emscripten-glfw] Patch already applied"
        fi
    else
        echo "[emscripten-glfw] Warning: Port not found, patch will be applied during build"
    fi
fi

# ============================================================================
# Done
# ============================================================================
echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  cd src/scripts"
echo "  ./build.sh        # or ./build.ps1 on Windows"
echo ""
