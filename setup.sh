#!/bin/bash
# WebChuGL Setup Script
# Clones dependencies, installs Emscripten SDK, and applies patches
#
# Usage: ./setup.sh

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

# Dependency versions
CHUGL_REPO="https://github.com/ccrma/chugl.git"
CHUGL_COMMIT="9d6245a"

CHUCK_REPO="https://github.com/ccrma/chuck.git"
CHUCK_COMMIT="60caede9"

EMSDK_VERSION="3.1.61"

echo "=== WebChuGL Setup ==="
echo ""

# ============================================================================
# Clone chugl
# ============================================================================
CHUGL_DIR="$PROJECT_ROOT/chugl"
if [ -d "$CHUGL_DIR" ]; then
    echo "[chugl] Directory exists, checking commit..."
    cd "$CHUGL_DIR"
    CURRENT_COMMIT=$(git rev-parse --short HEAD)
    if [ "$CURRENT_COMMIT" != "${CHUGL_COMMIT:0:7}" ]; then
        echo "[chugl] Warning: Current commit ($CURRENT_COMMIT) differs from expected ($CHUGL_COMMIT)"
        echo "[chugl] You may need to: git checkout $CHUGL_COMMIT"
    else
        echo "[chugl] Already at correct commit"
    fi
    cd "$PROJECT_ROOT"
else
    echo "[chugl] Cloning from $CHUGL_REPO..."
    git clone "$CHUGL_REPO" "$CHUGL_DIR"
    cd "$CHUGL_DIR"
    git checkout "$CHUGL_COMMIT"
    cd "$PROJECT_ROOT"
    echo "[chugl] Cloned and checked out $CHUGL_COMMIT"
fi

# ============================================================================
# Clone chuck
# ============================================================================
CHUCK_DIR="$PROJECT_ROOT/chuck"
if [ -d "$CHUCK_DIR" ]; then
    echo "[chuck] Directory exists, checking commit..."
    cd "$CHUCK_DIR"
    CURRENT_COMMIT=$(git rev-parse --short HEAD)
    if [ "$CURRENT_COMMIT" != "${CHUCK_COMMIT:0:8}" ]; then
        echo "[chuck] Warning: Current commit ($CURRENT_COMMIT) differs from expected ($CHUCK_COMMIT)"
        echo "[chuck] You may need to: git checkout $CHUCK_COMMIT"
    else
        echo "[chuck] Already at correct commit"
    fi
    cd "$PROJECT_ROOT"
else
    echo "[chuck] Cloning from $CHUCK_REPO..."
    git clone "$CHUCK_REPO" "$CHUCK_DIR"
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

    # Clone emsdk if needed
    if [ ! -d "$EMSDK_DIR" ]; then
        echo "[emsdk] Cloning emsdk..."
        git clone https://github.com/emscripten-core/emsdk.git "$EMSDK_DIR"
    fi

    cd "$EMSDK_DIR"

    echo "[emsdk] Installing version $EMSDK_VERSION..."
    ./emsdk install $EMSDK_VERSION

    echo "[emsdk] Activating version $EMSDK_VERSION..."
    ./emsdk activate $EMSDK_VERSION

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

# Apply chugl patch
CHUGL_PATCH="$PATCH_DIR/chugl.patch"
if [ -f "$CHUGL_PATCH" ]; then
    echo "[chugl] Applying patch..."
    cd "$CHUGL_DIR"
    if git apply --check "$CHUGL_PATCH" 2>/dev/null; then
        git apply "$CHUGL_PATCH"
        echo "[chugl] Patch applied successfully"
    else
        echo "[chugl] Patch already applied or conflicts exist"
    fi
    cd "$PROJECT_ROOT"
fi

# Apply chuck patch
CHUCK_PATCH="$PATCH_DIR/chuck.patch"
if [ -f "$CHUCK_PATCH" ]; then
    echo "[chuck] Applying patch..."
    cd "$CHUCK_DIR"
    if git apply --check "$CHUCK_PATCH" 2>/dev/null; then
        git apply "$CHUCK_PATCH"
        echo "[chuck] Patch applied successfully"
    else
        echo "[chuck] Patch already applied or conflicts exist"
    fi
    cd "$PROJECT_ROOT"
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
echo "  python serve.py"
echo ""
