# Dev Server for WebChuGL+HTML Development

## Problem

Iterating on a webchugl app (ChucK code + HTML controls) requires running the full `build.ps1` pipeline, which includes a slow C++ → WASM compilation step via Emscripten. The C++ code (ChucK core, ChuGL engine) rarely changes — only the ChucK source files (`src/code/`) and the HTML template (`src/web/shell.html`) change frequently during development.

## Solution

A lightweight dev server that watches source files and performs only the minimal rebuild steps needed — skipping C++ compilation entirely. Iteration drops from minutes to under a second.

## Usage

```powershell
# One-time (or after C++ changes): full build
./src/scripts/build.ps1

# Then iterate on HTML + ChucK:
./src/scripts/dev.ps1
```

## Architecture

```
dev.ps1 / dev.sh
  └─ Validates build/index.js + index.wasm exist
  └─ Calls: python src/scripts/dev_server.py
       ├─ Initial rebuild:
       │   ├─ Process shell.html template → build/index.html
       │   ├─ Bundle src/code/ → build/bundle.zip
       │   └─ Copy web assets (*.js, *.png) → build/
       ├─ Start HTTP server on localhost:8080
       │   └─ CORS headers for SharedArrayBuffer support
       └─ Watch loop (1s mtime polling):
            ├─ src/web/shell.html changed → re-process template
            ├─ src/web/*.js changed → copy to build/
            ├─ src/code/* changed → re-run create_bundle.py
            └─ Print "[HH:MM:SS] Rebuilt: <what changed>" to terminal
```

Browser reload is manual (F5).

## Rebuild Steps (what gets skipped)

| Change | What runs | What's skipped | Time |
|--------|-----------|----------------|------|
| shell.html | Template processing (string replace) | C++ compile, bundle | ~instant |
| *.ck files | create_bundle.py (zip) | C++ compile, template | ~1-2s |
| webchugl.js | File copy | C++ compile, template, bundle | ~instant |
| C++ code | N/A — run build.ps1 | Nothing | Full build |

## Template Processing

Emscripten's `--shell-file` replaces `{{{ SCRIPT }}}` in shell.html with:
```html
<script async type="text/javascript" src="index.js"></script>
```

The dev server does this same replacement without invoking Emscripten.

## HTTP Server

Python's built-in `http.server` with a custom handler that adds:
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

These headers are required for `SharedArrayBuffer` (used by the audio ring buffers and pthreads).

## File Watching

Simple mtime polling (check every ~1 second). No external Python packages required. Tracks `src/code/` and `src/web/` recursively.

## Files to Create

- `src/scripts/dev_server.py` — Python dev server + file watcher + rebuilder
- `src/scripts/dev.ps1` — PowerShell wrapper (validates prerequisites, calls Python)
- `src/scripts/dev.sh` — Bash wrapper (validates prerequisites, calls Python)

## Dependencies

None beyond what's already required (Python 3, which is used by existing build scripts).
