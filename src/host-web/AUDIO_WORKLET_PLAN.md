# WebChuGL Audio Worklet Architecture

## Overview

Split ChucK VM and ChuGL renderer into separate threads:
- **Audio Worklet Thread**: Runs ChucK VM, generates audio, produces ChuGL commands
- **Main Thread**: Runs ChuGL renderer, WebGPU, handles input

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Main Thread                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐    ┌─────────────────┐    ┌─────────────────────────────┐  │
│  │  shell.html │───►│  webchugl.js    │───►│  webchugl_graphics.wasm     │  │
│  │             │    │  (orchestrator) │    │  - ChuGL renderer           │  │
│  │  - UI       │    │  - Creates      │    │  - WebGPU/Canvas            │  │
│  │  - Canvas   │    │    AudioContext │    │  - Scene graph              │  │
│  │             │    │  - Loads worklet│    │  - Command executor         │  │
│  └─────────────┘    │  - Routes msgs  │    │  - Input state              │  │
│                     └────────┬────────┘    └──────────────▲──────────────┘  │
│                              │                            │                  │
│                              │ postMessage                │ execute commands │
│                              ▼                            │                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                          AudioWorkletNode                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Audio Worklet Thread                              │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │                                                                      │    │
│  │  ┌─────────────────────┐    ┌────────────────────────────────────┐  │    │
│  │  │ chuck_processor.js  │───►│  webchugl_audio.wasm               │  │    │
│  │  │ (AudioWorklet       │    │  - ChucK VM                        │  │    │
│  │  │  Processor)         │    │  - Audio synthesis                 │  │    │
│  │  │                     │    │  - Shred execution                 │  │    │
│  │  │ - process() called  │    │  - ChuGL command stubs             │──┼────┼──► Commands
│  │  │   128 samples/call  │    │    (serialize & send to main)     │  │    │    to main
│  │  └─────────────────────┘    └────────────────────────────────────┘  │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Message Protocol

### Main Thread → Audio Worklet

```javascript
// Load and run ChucK code
{ type: 'run', code: '...chuck code...' }

// Send input events
{ type: 'input', key: 32, action: 1 }  // key pressed
{ type: 'input', mouseX: 100, mouseY: 200 }

// Frame sync
{ type: 'frameComplete', frameId: 123 }
```

### Audio Worklet → Main Thread

```javascript
// ChuGL commands (batched per frame)
{
  type: 'commands',
  frameId: 123,
  buffer: ArrayBuffer  // Serialized command queue
}

// Console output
{ type: 'print', text: '...' }

// Events
{ type: 'event', name: 'eventName' }
```

## Implementation Steps

### Phase 1: Audio Worklet Basics
1. Create `chuck_processor.js` - AudioWorkletProcessor skeleton
2. Create `webchugl_audio.cpp` - ChucK-only WASM module
3. Test audio output (simple sine wave)

### Phase 2: Command Serialization
4. Create command serialization format (reuse existing CQ structs)
5. Implement command sending from worklet to main thread
6. Implement command receiving on main thread

### Phase 3: Graphics Integration
7. Modify main thread to run graphics-only loop
8. Execute received commands on scene graph
9. Test basic ChuGL program

### Phase 4: Synchronization
10. Implement GG.nextFrame() signaling
11. Handle input event forwarding
12. Frame timing synchronization

## Files to Create

```
src/host-web/
├── webchugl_main.cpp      (modify - graphics only)
├── webchugl_audio.cpp     (new - audio worklet entry)
├── chuck_processor.js     (new - AudioWorkletProcessor)
├── webchugl.js            (new - orchestrator)
├── shell.html             (modify - load new architecture)
└── CMakeLists.txt         (modify - two build targets)
```

## Build Targets

### webchugl_graphics.wasm
- ChuGL renderer
- WebGPU initialization
- Command executor
- No ChucK VM

### webchugl_audio.wasm
- ChucK VM
- Audio synthesis
- Command producer stubs
- No WebGPU/graphics

## Key Challenges

1. **SharedArrayBuffer**: Needed for efficient data transfer. Requires COOP/COEP headers.

2. **Command Queue Serialization**: Current CQ uses pointers. Need to convert to offsets/copies.

3. **GG.nextFrame() Sync**: Worklet runs at audio rate (128 samples), graphics at 60fps.
   - Solution: Accumulate commands until frameComplete message received.

4. **Input Forwarding**: Keyboard/mouse events happen on main thread, need to forward to worklet.

## COOP/COEP Headers

For SharedArrayBuffer support, server must send:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Python dev server with headers:
```python
# serve.py
from http.server import HTTPServer, SimpleHTTPRequestHandler
class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()
HTTPServer(('', 8000), Handler).serve_forever()
```
