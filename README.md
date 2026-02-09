# WebChuGL

[ChuGL](https://github.com/ccrma/chugl) compiled to WebAssembly via Emscripten. Runs [ChucK](https://chuck.stanford.edu/) programs with real-time graphics and audio in the browser using WebGPU and Web Audio.

## Requirements (for now)

- Python 3
- Git
- CMake
- Make (Unix) or included via emsdk (Windows)

## Setup

```bash
# Clone and set up dependencies (chuck, chugl, emsdk 3.1.61)
./setup.sh        # Unix
./setup.ps1       # Windows
```

This clones chuck and chugl at pinned commits, installs Emscripten 3.1.61, and applies patches from `patches/`.

## Build

Place your ChucK program at `src/code/main.ck`, then:

```bash
cd src/scripts
./build.sh        # Unix
./build.ps1       # Windows
```

The build script:
1. Copies `src/code/` to the build directory
2. Fetches any ChuMP packages listed in `src/code/packages.json`
3. Creates `bundle.zip` (code + packages, loaded at runtime via JSZip)
4. Compiles WebChuGL with Emscripten

Output goes to `src/build/`.

## Serve

```bash
python src/scripts/serve.py
# Open http://localhost:8000
```

Requires a browser with WebGPU support (Chrome, Edge).

## ChuGins

Pre-built `.chug.wasm` files for 34 web-compatible ChuGins are available in `chugins/`. To use a ChuGin, copy its `.chug.wasm` into `src/code/` before building.

To rebuild ChuGins from source (requires the [chugins repo](https://github.com/ccrma/chugins)):

```bash
cd src/scripts
./build_web_chugins.sh /path/to/chugins    # Unix (emcc must be on PATH)
./build_web_chugins.ps1 -ChuginsDir /path/to/chugins  # Windows
```

## Architecture

- **ChucK VM** runs on the main thread, driven by the ChuGL render loop
- **Audio** passes through lock-free ring buffers in WASM shared memory (`SharedArrayBuffer`) to a JS `AudioWorkletProcessor` on the audio thread
- **ChuGins** are loaded via `dlopen()` (`-sMAIN_MODULE=1` / `-sSIDE_MODULE=1`)
- **Graphics** uses WebGPU via ChuGL's rendering pipeline

## Project Structure

```
setup.sh / setup.ps1          # One-time dependency setup
patches/                       # Patches applied to chuck and chugl
src/
  CMakeLists.txt               # Emscripten build configuration
  code/                        # Your ChucK program (main.ck + assets)
  host/                        # C++ entry point and audio ring buffer
  web/                         # HTML shell, JS module config, audio worklet
  scripts/                     # Build, serve, and ChuGin build scripts
chugins/                       # Pre-built .chug.wasm files
```
