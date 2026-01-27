#!/usr/bin/env python3
"""
Development server for WebChuGL with COOP/COEP headers.

These headers are required for SharedArrayBuffer which enables
synchronization between Audio Worklet and Main Thread.

Usage:
    python serve.py [port]
    python serve.py 8000

Then open http://localhost:8000
"""

import http.server
import sys
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

class CORSRequestHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.wasm': 'application/wasm',
        '.js': 'application/javascript',
    }

    def do_GET(self):
        # Handle the request
        f = self.send_head()
        if f:
            try:
                self.copyfile(f, self.wfile)
            finally:
                f.close()

    def send_head(self):
        """Common code for GET and HEAD commands."""
        path = self.translate_path(self.path)

        # Serve program.ck from source directory for hot-reload
        if self.path.endswith('program.ck'):
            src_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            source_ck = os.path.join(src_dir, 'program.ck')
            if os.path.exists(source_ck):
                path = source_ck

        f = None
        if os.path.isdir(path):
            parts = self.path.split('?')
            if not parts[0].endswith('/'):
                self.send_response(301)
                self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
                self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
                new_parts = (parts[0] + '/', *parts[1:])
                self.send_header("Location", "?".join(new_parts))
                self.end_headers()
                return None
            for index in "index.html", "index.htm":
                index = os.path.join(path, index)
                if os.path.exists(index):
                    path = index
                    break
            else:
                return self.list_directory(path)
        ctype = self.guess_type(path)
        try:
            f = open(path, 'rb')
        except OSError:
            self.send_error(404, "File not found")
            return None
        try:
            fs = os.fstat(f.fileno())
            self.send_response(200)
            # Add COOP/COEP headers
            self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
            self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header("Content-type", ctype)
            self.send_header("Content-Length", str(fs[6]))
            self.send_header("Last-Modified",
                self.date_time_string(fs.st_mtime))
            # Disable caching for .ck files to enable hot-reload
            if path.endswith('.ck'):
                self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                self.send_header("Pragma", "no-cache")
                self.send_header("Expires", "0")
            self.end_headers()
            return f
        except:
            f.close()
            raise

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.end_headers()

if __name__ == '__main__':
    # Change to build directory
    src_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    build_dir = os.path.join(src_dir, 'build')
    if os.path.exists(build_dir):
        os.chdir(build_dir)
        print(f"Serving from: {build_dir}")
    else:
        print(f"Warning: build directory not found, serving from current directory")

    print(f"Starting server at http://localhost:{PORT}")
    print("COOP/COEP headers enabled for SharedArrayBuffer support")
    print("Press Ctrl+C to stop")
    print()

    with http.server.HTTPServer(('', PORT), CORSRequestHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped")
