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

### JS ↔ ChucK Communication

```js
// Set global variables
ck.setFloat('speed', 2.5);
ck.setInt('mode', 1);
ck.setString('name', 'hello');

// Get global variables
var val = await ck.getFloat('speed');

// Events
ck.signalEvent('reset');
ck.broadcastEvent('reset');
ck.listenForEvent('beat', function() { console.log('beat!'); });

// Arrays
ck.setFloatArray('data', [1.0, 2.0, 3.0]);
var arr = await ck.getFloatArray('data');
```

### Loading ChuGins

```js
// At init time (loaded before VM starts)
var ck = await ChuGL.init({
    canvas: myCanvas,
    whereIsChuGL: './webchugl/',
    chugins: ['./chugins/Bitcrusher.chug.wasm'],
});

// Or after init
await ck.loadChugin('./chugins/NHHall.chug.wasm');
ck.runCode('NHHall rev => dac;');
```

### Loading ChuMP Packages

```js
await ck.loadPackage('ChuGUI');                    // latest from registry
await ck.loadPackage('ChuGUI', '0.1.3');           // specific version
await ck.loadPackage('Custom', '1.0', 'https://example.com/custom.zip');  // direct URL

ck.runCode('@import ChuGUI; // ...');
```

### Other APIs

```js
// Write files to the virtual filesystem
ck.createFile('/audio/sample.wav', arrayBuffer);

// Fetch and decode audio to WAV in VFS
await ck.loadAudio('https://example.com/sound.mp3', '/audio/sound.wav');

// MIDI (Web MIDI API)
var access = await navigator.requestMIDIAccess();
ck.initMidi(access);

// Persistent storage (IndexedDB)
await ck.save('key', value);
var val = await ck.load('key');

// Audio access
ck.audioContext;  // AudioContext
ck.audioNode;     // AudioWorkletNode
```

## Examples

Each example in the `examples/` directory is a self-contained project with an `index.html` and `index.js`:

- **Date the Dobots** — A full ChuGL game running via `runZip`
- **Drum Machine** — Step-sequenced drum machine with HTML UI
- **HTML UI** — HTML controls driving ChucK synth parameters
- **Recorder** — Record audio output to WAV
- **Data Sonification** — Fetch and sonify JSON data
- **Web Data** — Live earthquake visualization from USGS
- **MIDI** — Real-time MIDI controller input
- **Speech Recognition** — Voice-controlled ChucK programs
- **MediaPipe** — Hand tracking drives audio and visuals
- **Gamepad** — Gamepad/joystick input
- **Drag & Drop** — Drag audio files into ChucK
- **Plugins** — Dynamic ChuGin and ChuMP loading

## Building ChuGins

Pre-built `.chug.wasm` files are available in `chugins/`. To rebuild from source (requires the [chugins repo](https://github.com/ccrma/chugins)):

```bash
cd src/scripts
./build_web_chugins.sh /path/to/chugins    # Unix
./build_web_chugins.ps1 -ChuginsDir /path/to/chugins  # Windows
```

## Cross-Origin Isolation

WebChuGL requires `SharedArrayBuffer` for audio, which needs cross-origin isolation. Options:

1. **Service worker** (default): WebChuGL registers `sw.js` which injects COOP/COEP headers. Just serve with any HTTP server.
2. **Server headers**: Set `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`, then pass `serviceWorker: false` in init config.

## Architecture

- **Audio** passes through a `SharedArrayBuffer` to a JS `AudioWorkletProcessor` on the audio thread
- **Graphics** uses WebGPU via ChuGL's rendering pipeline
- **ChuGins** are loaded via `dlopen()` (`-sMAIN_MODULE=1` / `-sSIDE_MODULE=1`)
