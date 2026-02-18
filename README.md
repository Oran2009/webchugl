# WebChuGL

[ChuGL](https://github.com/ccrma/chugl) compiled to WebAssembly via Emscripten. Runs [ChucK](https://chuck.stanford.edu/) programs with real-time graphics and audio in the browser using WebGPU and Web Audio.

## Requirements

- Python 3
- Git
- CMake
- Make (Unix) or included via emsdk (Windows)

## Setup

```bash
# Clone and set up dependencies (chuck, chugl, emsdk)
./setup.sh        # Unix
./setup.ps1       # Windows
```

## Build

```bash
cd src/scripts
./build.sh        # Unix
./build.ps1       # Windows
```

Output goes to `src/build/`. The `webchugl/` subdirectory contains the runtime assets.

## Usage (ESM)

Import from CDN (no build step required):

```html
<canvas id="canvas"></canvas>
<script type="module">
    import ChuGL from 'https://cdn.jsdelivr.net/npm/webchugl/+esm';

    var ck = await ChuGL.init({
        canvas: document.getElementById('canvas'),
    });

    // Run ChucK code directly
    ck.runCode('SinOsc s => dac; while(true) GG.nextFrame() => now;');

    // Or run a .ck file (fetched automatically)
    await ck.runFile('./main.ck');
</script>
```

Or import from a self-hosted build:

```js
import ChuGL from './webchugl/webchugl-esm.js';

var ck = await ChuGL.init({
    canvas: document.getElementById('canvas'),
    whereIsChuGL: './webchugl/',
});

await ck.runFile('./main.ck');
```

## Architecture

- **Audio** passes through a `SharedArrayBuffer` to a JS `AudioWorkletProcessor` on the audio thread
- **Graphics** uses WebGPU via ChuGL's rendering pipeline
- **ChuGins** are loaded via `dlopen()` (`-sMAIN_MODULE=1` / `-sSIDE_MODULE=1`)
