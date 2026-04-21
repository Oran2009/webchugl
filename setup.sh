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
CHUGL_COMMIT="0c6902896babdd713f083dc9937871be1c8e91d5"

CHUCK_REPO="https://github.com/ccrma/chuck.git"
CHUCK_TAG="chuck-1.5.5.8"

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
    echo "[chugl] Directory exists, checking commit..."
    cd "$CHUGL_DIR"
    CURRENT_COMMIT=$(git rev-parse HEAD)
    if [ "$CURRENT_COMMIT" != "$CHUGL_COMMIT" ]; then
        echo "[chugl] Warning: Current commit ($CURRENT_COMMIT) differs from expected ($CHUGL_COMMIT)"
        echo "[chugl] You may need to: git fetch && git checkout $CHUGL_COMMIT"
    else
        echo "[chugl] Already at pinned commit"
    fi
    cd "$PROJECT_ROOT"
else
    echo "[chugl] Cloning from $CHUGL_REPO..."
    git clone --filter=blob:none "$CHUGL_REPO" "$CHUGL_DIR"
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
    echo "[chuck] Directory exists, checking tag..."
    cd "$CHUCK_DIR"
    # Resolve the tag to a commit. `^{}` dereferences annotated tags to the
    # underlying commit object; `-q --verify` returns non-zero (and empty
    # output) if the tag is unknown locally.
    EXPECTED=$(git rev-parse -q --verify "${CHUCK_TAG}^{}" 2>/dev/null || true)
    if [ -z "$EXPECTED" ]; then
        echo "[chuck] tag '$CHUCK_TAG' not found locally; run: git fetch --tags"
    else
        CURRENT_COMMIT=$(git rev-parse HEAD)
        if [ "$CURRENT_COMMIT" != "$EXPECTED" ]; then
            echo "[chuck] Warning: Current commit ($CURRENT_COMMIT) differs from tag '$CHUCK_TAG' ($EXPECTED)"
            echo "[chuck] You may need to: git fetch --tags && git checkout $CHUCK_TAG"
        else
            echo "[chuck] Already at pinned tag $CHUCK_TAG"
        fi
    fi
    cd "$PROJECT_ROOT"
else
    echo "[chuck] Cloning from $CHUCK_REPO..."
    git clone --filter=blob:none "$CHUCK_REPO" "$CHUCK_DIR"
    cd "$CHUCK_DIR"
    git checkout "$CHUCK_TAG"
    cd "$PROJECT_ROOT"
    echo "[chuck] Cloned and checked out $CHUCK_TAG"
fi

# ============================================================================
# Install Emscripten SDK
# ============================================================================
EMSDK_DIR="$PROJECT_ROOT/emsdk-$EMSDK_VERSION"
EMSDK_INSTALL="$EMSDK_DIR/install/emscripten"

assert_emsdk_version() {
    local install_dir="$1"
    local expected="$2"
    if [ ! -x "$install_dir/em++" ]; then
        echo "[emsdk] ERROR: em++ missing at $install_dir/em++ — install is corrupt" >&2
        exit 1
    fi
    local output
    output=$("$install_dir/em++" --version 2>&1 | head -1) || {
        echo "[emsdk] ERROR: em++ --version failed: $output" >&2
        exit 1
    }
    if ! echo "$output" | grep -qF "$expected"; then
        echo "[emsdk] ERROR: Version mismatch. Expected $expected, got: $output" >&2
        exit 1
    fi
    echo "[emsdk] Verified: $output"
}

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

assert_emsdk_version "$EMSDK_INSTALL" "$EMSDK_VERSION"

# ============================================================================
# Pre-fetch Emscripten ports
# ============================================================================
# Some Python builds fail to download Emscripten ports over HTTPS during the
# build, so we pre-seed the contrib.glfw3 port cache with curl here.

echo ""
echo "=== Pre-fetching Emscripten Ports ==="

GLFW_PORT_DIR="$EMSDK_INSTALL/cache/ports/contrib.glfw3"
if [ ! -d "$GLFW_PORT_DIR" ]; then
    GLFW_PORT_URL="https://github.com/pongasoft/emscripten-glfw/releases/download/v3.4.0.20260301/emscripten-glfw3-3.4.0.20260301.zip"
    GLFW_PORT_ZIP="$EMSDK_INSTALL/cache/ports/contrib.glfw3.zip"
    CACHE_PORTS_DIR="$EMSDK_INSTALL/cache/ports"

    echo "[emscripten-glfw] Downloading contrib.glfw3 port..."
    mkdir -p "$CACHE_PORTS_DIR"
    curl -L --fail -o "$GLFW_PORT_ZIP" "$GLFW_PORT_URL"

    # Verify download integrity
    GLFW_EXPECTED_SHA256="d7f96c31ae5433bae2950b36f79a03a74c892d132da291c262e10fdf267fe57b"
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
