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

class CachingHandler(http.server.SimpleHTTPRequestHandler):
    """Adds cache headers for static assets."""

    # WASM and JS glue don't change between rebuilds of the same code
    CACHE_EXTENSIONS = {
        '.wasm': 3600,
        '.js': 3600,
        '.png': 3600,
        '.zip': 3600,
    }

    def end_headers(self):
        ext = os.path.splitext(self.path.split('?')[0])[1].lower()
        max_age = self.CACHE_EXTENSIONS.get(ext, 0)
        if max_age:
            self.send_header('Cache-Control', f'public, max-age={max_age}')
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

    with http.server.ThreadingHTTPServer(('', PORT), CachingHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nServer stopped.')
