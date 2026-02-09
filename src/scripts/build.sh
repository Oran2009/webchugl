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
    python3 -c "
import json, urllib.request, zipfile, io, os, shutil, sys, glob

packages_json = sys.argv[1]
output_dir = sys.argv[2]

with open(packages_json) as f:
    config = json.load(f)

os.makedirs(output_dir, exist_ok=True)

for pkg in config.get('packages', []):
    name = pkg['name']
    version = pkg['version']
    pkg_dir = os.path.join(output_dir, name)

    # Skip if already fetched
    if os.path.isdir(pkg_dir):
        print(f'  {name} {version} (cached)')
        continue

    print(f'  Fetching {name} {version}...')

    # Download ZIP from URL specified in packages.json
    zip_url = pkg.get('url')
    if not zip_url:
        print(f'  ERROR: No url specified for {name}')
        continue
    try:
        zip_data = urllib.request.urlopen(zip_url).read()
    except Exception as e:
        print(f'  ERROR: Could not download {name}: {e}')
        continue

    # Extract to packages/<name>/
    os.makedirs(pkg_dir, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
        zf.extractall(pkg_dir)

    # Strip non-essential directories
    for strip_dir in ['examples', '_examples', 'scripts', 'releases', '.git']:
        strip_path = os.path.join(pkg_dir, strip_dir)
        if os.path.isdir(strip_path):
            shutil.rmtree(strip_path)

    # Strip non-essential files
    for pattern in ['README*', 'VERSIONS', 'imgui.ini', '*.md']:
        for match in glob.glob(os.path.join(pkg_dir, pattern)):
            if os.path.isfile(match):
                os.remove(match)

    print(f'  Installed {name} {version}')
" "$PACKAGES_JSON" "$BUILD_PACKAGES_DIR"
fi

# Create bundle.zip containing code/ and packages/ directories
echo "Creating bundle.zip..."
cd "$BUILD_DIR"
python3 -c "
import zipfile, os

files = []
for dirpath in ['code', 'packages']:
    if not os.path.isdir(dirpath):
        continue
    for root, dirs, filenames in os.walk(dirpath):
        for f in filenames:
            path = os.path.join(root, f).replace('\\\\', '/')
            files.append(path)

with zipfile.ZipFile('bundle.zip', 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
    for path in files:
        zf.write(path, path)

raw_size = sum(os.path.getsize(f) for f in files)
zip_size = os.path.getsize('bundle.zip')
ratio = (1 - zip_size / raw_size) * 100 if raw_size > 0 else 0
print(f'Created bundle.zip: {len(files)} files, {raw_size/1024/1024:.1f} MB -> {zip_size/1024/1024:.1f} MB ({ratio:.0f}% compression)')
"
cd "$SRC_DIR"

# Build
echo "Building WASM..."
cd "$BUILD_DIR"
"$EMMAKE" make -j "$JOBS"

echo ""
echo "=== Build Complete ==="
echo "Output: $BUILD_DIR/index.html"
echo "To test: python scripts/serve.py"
