#!/usr/bin/env python3
"""WebChuGL dev server — fast iteration on HTML + ChucK code.

Watches src/code/, src/web/, and examples/ for changes, rebuilds only what's
needed (skipping C++ compilation), and serves the result.

Examples:
    python dev_server.py [port]
    python dev_server.py 8080

    Then visit http://localhost:8080/?example=web-data to load an example.
"""

import http.server
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse

# ── Paths ──────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
PROJECT_DIR = os.path.dirname(SRC_DIR)
BUILD_DIR = os.path.join(SRC_DIR, 'build')
WEB_DIR = os.path.join(SRC_DIR, 'web')
CODE_DIR = os.path.join(SRC_DIR, 'code')
EXAMPLES_DIR = os.path.join(PROJECT_DIR, 'examples')

# Files that go into build/webchugl/ (relative to src/web/)
WEBCHUGL_DIR_FILES = [
    'webchugl.js',
    'audio-worklet-processor.js',
    'jszip.min.js',
    'chugl_logo_light.png',
    'chugl_logo_dark.png',
]

# Files that go into build/ root (relative to src/web/)
ROOT_FILES = [
    'sw.js',
    'manifest.json',
]

# ── Example state ─────────────────────────────────────────────────
_current_example = None  # name of the currently loaded example, or None


def process_template():
    """Copy shell.html to build/index.html."""
    src = os.path.join(WEB_DIR, 'shell.html')
    dst = os.path.join(BUILD_DIR, 'index.html')
    shutil.copy2(src, dst)


def rebuild_bundle(example=None):
    """Re-create bundle.zip from src/code/ (via create_bundle.py).

    If example is set, replaces code/main.ck with the example's main.ck.
    """
    build_code = os.path.join(BUILD_DIR, 'code')
    if os.path.exists(build_code):
        shutil.rmtree(build_code)
    shutil.copytree(CODE_DIR, build_code)

    # Override main.ck with example's version
    if example:
        example_ck = os.path.join(EXAMPLES_DIR, example, 'main.ck')
        if os.path.exists(example_ck):
            shutil.copy2(example_ck, os.path.join(build_code, 'main.ck'))

    subprocess.run(
        [sys.executable, os.path.join(SCRIPT_DIR, 'create_bundle.py'), BUILD_DIR],
        check=True,
    )

    shutil.rmtree(build_code)


def apply_example(example):
    """Switch to a different example (or None for default). Rebuilds bundle and copies setup.js."""
    global _current_example
    if example == _current_example:
        return

    _current_example = example
    rebuild_bundle(example)

    setup_dst = os.path.join(BUILD_DIR, 'example-setup.js')
    if example:
        setup_src = os.path.join(EXAMPLES_DIR, example, 'setup.js')
        if os.path.exists(setup_src):
            shutil.copy2(setup_src, setup_dst)
        else:
            # No setup.js — write empty file
            with open(setup_dst, 'w') as f:
                f.write('// No setup.js for this example\n')
        log(f'Loaded example: {example}')
    else:
        # Remove leftover setup.js when switching back to default
        if os.path.exists(setup_dst):
            os.remove(setup_dst)
        log('Loaded default program')


def copy_web_assets():
    """Copy web assets from src/web/ to build/ in organized structure."""
    webchugl_dir = os.path.join(BUILD_DIR, 'webchugl')
    os.makedirs(webchugl_dir, exist_ok=True)

    for name in WEBCHUGL_DIR_FILES:
        src = os.path.join(WEB_DIR, name)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(webchugl_dir, name))

    for name in ROOT_FILES:
        src = os.path.join(WEB_DIR, name)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(BUILD_DIR, name))


def full_rebuild():
    """Run all rebuild steps (template + bundle + assets)."""
    process_template()
    rebuild_bundle(_current_example)
    copy_web_assets()
    log('Full rebuild complete')


def log(msg):
    """Print a timestamped message."""
    t = time.strftime('%H:%M:%S')
    print(f'[{t}] {msg}')


# ── HTTP Server ────────────────────────────────────────────────────

class DevHandler(http.server.SimpleHTTPRequestHandler):
    """Serves build/ with no-store caching.

    COOP/COEP headers for SharedArrayBuffer are provided by sw.js, not
    this server.  The first page load triggers a SW-driven reload.

    When ?example=<name> is present, injects the example's setup.js into
    the HTML response and triggers a bundle rebuild if the example changed.
    """

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        example = params.get('example', [None])[0]

        # For root or index.html requests, handle example switching
        if parsed.path in ('/', '/index.html'):
            apply_example(example)

            if example:
                # Serve modified HTML with injected setup.js
                html_path = os.path.join(BUILD_DIR, 'index.html')
                with open(html_path, 'rb') as f:
                    html = f.read().decode('utf-8')

                # CK bridge auto-queues calls until WASM is ready,
                # so setup.js can run at any time safely.
                injection = '    <script src="example-setup.js"></script>\n'
                html = html.replace('</body>', injection + '</body>')

                data = html.encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return

        # Strip query params so SimpleHTTPRequestHandler finds the right file
        self.path = parsed.path
        super().do_GET()

    def log_message(self, format, *args):
        # Suppress default access logs (noisy during dev)
        pass


def start_server(port):
    """Start the HTTP server serving build/."""
    os.chdir(BUILD_DIR)
    httpd = http.server.ThreadingHTTPServer(('', port), DevHandler)
    print(f'Serving at http://localhost:{port}')
    if os.path.isdir(EXAMPLES_DIR):
        examples = sorted(d for d in os.listdir(EXAMPLES_DIR)
                          if os.path.isdir(os.path.join(EXAMPLES_DIR, d)))
        if examples:
            print(f'Available examples:')
            for ex in examples:
                print(f'  http://localhost:{port}/?example={ex}')
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
    examples_mtimes = get_mtimes(EXAMPLES_DIR)

    while True:
        time.sleep(1)

        # Check web/ changes
        new_web = get_mtimes(WEB_DIR)
        if new_web != web_mtimes:
            changed = set(new_web.keys()) - set(web_mtimes.keys())
            changed |= {k for k in new_web if web_mtimes.get(k) != new_web.get(k)}

            shell_changed = any('shell.html' in c for c in changed)
            assets_changed = any('shell.html' not in c for c in changed)

            try:
                if shell_changed:
                    process_template()
                    log('Rebuilt: shell.html → index.html')
                if assets_changed:
                    copy_web_assets()
                    log('Rebuilt: web assets copied')
            except Exception as e:
                log(f'ERROR: Web rebuild failed: {e}')

            web_mtimes = new_web

        # Check code/ changes
        new_code = get_mtimes(CODE_DIR)
        if new_code != code_mtimes:
            try:
                rebuild_bundle(_current_example)
                log('Rebuilt: code/ → bundle.zip')
            except Exception as e:
                log(f'ERROR: Bundle rebuild failed: {e}')
            code_mtimes = new_code

        # Check examples/ changes
        new_examples = get_mtimes(EXAMPLES_DIR)
        if new_examples != examples_mtimes:
            if _current_example:
                try:
                    rebuild_bundle(_current_example)
                    # Also re-copy setup.js
                    setup_src = os.path.join(EXAMPLES_DIR, _current_example, 'setup.js')
                    setup_dst = os.path.join(BUILD_DIR, 'example-setup.js')
                    if os.path.exists(setup_src):
                        shutil.copy2(setup_src, setup_dst)
                    log(f'Rebuilt: examples/{_current_example}/ → bundle.zip')
                except Exception as e:
                    log(f'ERROR: Example rebuild failed: {e}')
            examples_mtimes = new_examples


# ── Main ───────────────────────────────────────────────────────────

def validate_prerequisites():
    """Check that a full build has been done at least once. Migrate flat layout if needed."""
    webchugl_dir = os.path.join(BUILD_DIR, 'webchugl')
    wasm_files = ['index.js', 'index.wasm']

    # Migrate from old flat layout: move index.js/index.wasm into webchugl/
    if not os.path.exists(os.path.join(webchugl_dir, 'index.js')) \
       and os.path.exists(os.path.join(BUILD_DIR, 'index.js')):
        os.makedirs(webchugl_dir, exist_ok=True)
        for f in wasm_files:
            src = os.path.join(BUILD_DIR, f)
            if os.path.exists(src):
                shutil.move(src, os.path.join(webchugl_dir, f))
        print('Migrated index.js/index.wasm into webchugl/')

    required = [os.path.join('webchugl', f) for f in wasm_files]
    missing = [f for f in required if not os.path.exists(os.path.join(BUILD_DIR, f))]
    if missing:
        print(f'Error: {", ".join(missing)} not found in {BUILD_DIR}')
        print('Run build.ps1 (or build.sh) first to do the initial C++ compilation.')
        sys.exit(1)


if __name__ == '__main__':
    try:
        port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
        if not (1 <= port <= 65535):
            raise ValueError
    except ValueError:
        print('Error: Port must be a number between 1 and 65535')
        sys.exit(1)

    validate_prerequisites()
    full_rebuild()

    try:
        httpd = start_server(port)
    except OSError:
        print(f'Error: Port {port} is already in use.')
        print(f'Try a different port: python dev_server.py <port>')
        sys.exit(1)

    watcher = threading.Thread(target=watch_and_rebuild, daemon=True)
    watcher.start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nDev server stopped.')
