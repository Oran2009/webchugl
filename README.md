# WebChuGL

[ChuGL](https://github.com/ccrma/chugl) compiled to WebAssembly via Emscripten. Runs [ChucK](https://chuck.stanford.edu/) programs with real-time graphics and audio in the browser using WebGPU and Web Audio.

## Requirements (for now)

- Python 3
- Git
- CMake
- Make (Unix) or included via emsdk (Windows)

## Setup

```bash
# Clone and set up dependencies (chuck, chugl, emsdk 4.0.17)
./setup.sh        # Unix
./setup.ps1       # Windows
```

This clones chuck and chugl at pinned commits, installs Emscripten 4.0.17, and applies patches from `patches/`.

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
python src/scripts/dev_server.py
# Open http://localhost:8080
```

Requires a browser with WebGPU support (Chrome, Edge).

## ChuGins

Pre-built `.chug.wasm` files for select web-compatible ChuGins are available in `chugins/`. To use a ChuGin, copy its `.chug.wasm` into `src/code/` before building.

To rebuild ChuGins from source (requires the [chugins repo](https://github.com/ccrma/chugins)):

```bash
cd src/scripts
./build_web_chugins.sh /path/to/chugins    # Unix (emcc must be on PATH)
./build_web_chugins.ps1 -ChuginsDir /path/to/chugins  # Windows
```

## HTML Integration

### ChucK side

Declare global variables and events in your `.ck` file:

```chuck
global float speed;
global int mode;
global Event reset;

spork ~ fun void listener() {
    while (true) {
        reset => now;
        // handle reset
    }
};

while (true) {
    GG.nextFrame() => now;
    // use speed, mode, etc.
}
```

### JS side

```js
CK.setFloat('speed', 2.5);       // set a global float
CK.setInt('mode', 1);            // set a global int
CK.setString('name', 'hello');   // set a global string
CK.signalEvent('reset');         // wake one shred waiting on the event
CK.broadcastEvent('reset');      // wake all shreds waiting on the event
```

### Example

```html
<input type="range" id="speed-slider" min="0" max="10" step="0.1" value="1">
<script>
document.getElementById('speed-slider').addEventListener('input', function(e) {
    CK.setFloat('speed', parseFloat(e.target.value));
});
</script>
```

## Architecture

- **Audio** passes through a `SharedArrayBuffer` to a JS `AudioWorkletProcessor` on the audio thread
- **Graphics** uses WebGPU via ChuGL's rendering pipeline
- **ChuGins** are loaded via `dlopen()` (`-sMAIN_MODULE=1` / `-sSIDE_MODULE=1`) (ChuGins need to be compiled with `-sSIDE_MODULE=1` and `-pthread`)
