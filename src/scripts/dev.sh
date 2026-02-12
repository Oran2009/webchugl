#!/bin/bash
# WebChuGL dev server — fast iteration on HTML + ChucK code
# Usage: ./dev.sh [port]
# Requires: initial build via build.sh

set -e

PORT="${1:-8080}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$SRC_DIR/build"

# Validate prerequisites
if [ ! -f "$BUILD_DIR/index.js" ] || [ ! -f "$BUILD_DIR/index.wasm" ]; then
    echo "Error: build/index.js or index.wasm not found."
    echo "Run build.sh first to do the initial C++ compilation."
    exit 1
fi

echo "Starting WebChuGL dev server..."
echo "Watching src/code/ and src/web/ for changes"
echo ""

python3 "$SCRIPT_DIR/dev_server.py" "$PORT"
