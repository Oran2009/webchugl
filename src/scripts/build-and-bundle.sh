#!/bin/bash
# Build WebChuGL and create bundle.zip in one step
# Usage: ./build-and-bundle.sh [--clean] [-j N]
#
# Equivalent to running build.sh followed by bundle.sh.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

"$SCRIPT_DIR/build.sh" "$@"
"$SCRIPT_DIR/bundle.sh"
