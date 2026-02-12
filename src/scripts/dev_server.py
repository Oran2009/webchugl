#!/usr/bin/env python3
"""WebChuGL dev server — fast iteration on HTML + ChucK code.

Watches src/code/ and src/web/ for changes, rebuilds only what's needed
(skipping C++ compilation), and serves the result.

Usage:
    python dev_server.py [port]
    python dev_server.py 8080
"""

import http.server
import os
import shutil
import subprocess
import sys
import threading
import time

# ── Paths ──────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.dirname(SCRIPT_DIR)
BUILD_DIR = os.path.join(SRC_DIR, 'build')
WEB_DIR = os.path.join(SRC_DIR, 'web')
CODE_DIR = os.path.join(SRC_DIR, 'code')

EMSCRIPTEN_SCRIPT_TAG = '<script async type="text/javascript" src="index.js"></script>'

# Web assets to copy (everything in src/web/ except shell.html)
WEB_ASSETS = [
    'webchugl.js',
    'audio-worklet-processor.js',
    'coi-serviceworker.js',
    'jszip.min.js',
    'chugl_logo_light.png',
    'chugl_logo_dark.png',
]


def process_template():
    """Replace {{{ SCRIPT }}} in shell.html and write to build/index.html."""
    src = os.path.join(WEB_DIR, 'shell.html')
    dst = os.path.join(BUILD_DIR, 'index.html')
    with open(src, 'r', encoding='utf-8') as f:
        html = f.read()
    html = html.replace('{{{ SCRIPT }}}', EMSCRIPTEN_SCRIPT_TAG)
    with open(dst, 'w', encoding='utf-8') as f:
        f.write(html)


def rebuild_bundle():
    """Re-create bundle.zip from src/code/ (via create_bundle.py)."""
    build_code = os.path.join(BUILD_DIR, 'code')
    if os.path.exists(build_code):
        shutil.rmtree(build_code)
    shutil.copytree(CODE_DIR, build_code)

    subprocess.run(
        [sys.executable, os.path.join(SCRIPT_DIR, 'create_bundle.py'), BUILD_DIR],
        check=True,
    )

    shutil.rmtree(build_code)


def copy_web_assets():
    """Copy JS/PNG assets from src/web/ to build/."""
    for name in WEB_ASSETS:
        src = os.path.join(WEB_DIR, name)
        dst = os.path.join(BUILD_DIR, name)
        if os.path.exists(src):
            shutil.copy2(src, dst)


def full_rebuild():
    """Run all rebuild steps (template + bundle + assets)."""
    process_template()
    rebuild_bundle()
    copy_web_assets()
    log('Full rebuild complete')


def log(msg):
    """Print a timestamped message."""
    t = time.strftime('%H:%M:%S')
    print(f'[{t}] {msg}')


# ── HTTP Server ────────────────────────────────────────────────────

class DevHandler(http.server.SimpleHTTPRequestHandler):
    """Serves build/ with CORS headers required for SharedArrayBuffer."""

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, format, *args):
        # Suppress default access logs (noisy during dev)
        pass


def start_server(port):
    """Start the HTTP server serving build/."""
    os.chdir(BUILD_DIR)
    httpd = http.server.ThreadingHTTPServer(('', port), DevHandler)
    print(f'Serving at http://localhost:{port}')
    print('Press Ctrl+C to stop\n')
    return httpd


# ── File Watcher ───────────────────────────────────────────────────

def get_mtimes(directory):
    """Get dict of {filepath: mtime} for all files in a directory tree."""
    mtimes = {}
    if not os.path.isdir(directory):
        return mtimes
    for root, dirs, files in os.walk(directory):
        for f in files:
            path = os.path.join(root, f)
            try:
                mtimes[path] = os.path.getmtime(path)
            except OSError:
                pass
    return mtimes


def watch_and_rebuild():
    """Poll for file changes every second, rebuild as needed."""
    web_mtimes = get_mtimes(WEB_DIR)
    code_mtimes = get_mtimes(CODE_DIR)

    while True:
        time.sleep(1)

        # Check web/ changes
        new_web = get_mtimes(WEB_DIR)
        if new_web != web_mtimes:
            changed = set(new_web.keys()) - set(web_mtimes.keys())
            changed |= {k for k in new_web if web_mtimes.get(k) != new_web.get(k)}

            shell_changed = any('shell.html' in c for c in changed)
            assets_changed = any('shell.html' not in c for c in changed)

            if shell_changed:
                process_template()
                log('Rebuilt: shell.html → index.html')
            if assets_changed:
                copy_web_assets()
                log('Rebuilt: web assets copied')

            web_mtimes = new_web

        # Check code/ changes
        new_code = get_mtimes(CODE_DIR)
        if new_code != code_mtimes:
            rebuild_bundle()
            log('Rebuilt: code/ → bundle.zip')
            code_mtimes = new_code


# ── Main ───────────────────────────────────────────────────────────

def validate_prerequisites():
    """Check that a full build has been done at least once."""
    required = ['index.js', 'index.wasm']
    missing = [f for f in required if not os.path.exists(os.path.join(BUILD_DIR, f))]
    if missing:
        print(f'Error: {", ".join(missing)} not found in {BUILD_DIR}')
        print('Run build.ps1 (or build.sh) first to do the initial C++ compilation.')
        sys.exit(1)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080

    validate_prerequisites()
    full_rebuild()

    httpd = start_server(port)

    watcher = threading.Thread(target=watch_and_rebuild, daemon=True)
    watcher.start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nDev server stopped.')
