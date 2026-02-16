#!/bin/bash
# WebChuGL dev server — fast iteration on HTML + ChucK code
# Usage: ./dev.sh [port]
# Requires: initial build via build.sh

set -e

PORT="${1:-8080}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Starting WebChuGL dev server..."
echo "Watching src/code/ and src/web/ for changes"
echo ""

python3 "$SCRIPT_DIR/py/dev_server.py" "$PORT"
