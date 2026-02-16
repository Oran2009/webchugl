#!/bin/bash
# Bundle WebChuGL code and packages into bundle.zip
# Usage: ./bundle.sh
#
# Copies src/code/ into the build directory, fetches ChuMP packages,
# and creates bundle.zip. Does NOT recompile WASM.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$SRC_DIR/build"
CODE_DIR="$SRC_DIR/code"
PY_DIR="$SCRIPT_DIR/py"

echo "=== Bundling ==="

# Copy code directory to build/code/
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
    python3 "$PY_DIR/fetch_packages.py" "$PACKAGES_JSON" "$BUILD_PACKAGES_DIR"
fi

# Create bundle.zip
echo "Creating bundle.zip..."
python3 "$PY_DIR/create_bundle.py" "$BUILD_DIR"

# Clean up source directories (already in bundle.zip)
rm -rf "$BUILD_DIR/code" "$BUILD_DIR/packages"

echo ""
echo "=== Bundle Complete ==="
