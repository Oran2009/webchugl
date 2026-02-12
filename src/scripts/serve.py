#!/usr/bin/env python3
"""
Development server for WebChuGL

Usage:
    python serve.py [port]
    python serve.py 8000

Then open http://localhost:8000
"""

import http.server
import sys
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    """Disables caching for development (prevents stale WASM/JS)."""

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

if __name__ == '__main__':
    src_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    build_dir = os.path.join(src_dir, 'build')
    if os.path.exists(build_dir):
        os.chdir(build_dir)
        print(f'Serving from: {build_dir}')
    else:
        print(f'Warning: build directory not found, serving from current directory')

    print(f'Starting server at http://localhost:{PORT}')
    print('Press Ctrl+C to stop')
    print()

    with http.server.ThreadingHTTPServer(('', PORT), NoCacheHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nServer stopped.')
