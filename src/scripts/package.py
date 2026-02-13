#!/usr/bin/env python3
"""Package a ChucK program for WebChuGL deployment.

Takes pre-built WebChuGL runtime artifacts + user code/assets and produces
a ready-to-serve web directory. This is the reference implementation for
how ChAPP (or any other tool) should package WebChuGL apps.

Usage:
    python package.py --runtime <build_dir> --code <code_dir> --output <out_dir>
    python package.py --runtime <build_dir> --code <code_dir> --output <out_dir> --title "My App"

Arguments:
    --runtime   Directory containing pre-built WebChuGL runtime (from a full build)
    --code      Directory containing .ck files and assets (must contain main.ck)
    --output    Output directory for the packaged web app
    --title     Page title (default: "WebChuGL")
    --packages  Directory containing ChuGin packages (optional)

The runtime directory should be organized as:
    index.html, sw.js, manifest.json              (root)
    webchugl/index.js, webchugl/index.wasm, ...   (webchugl/ subdirectory)

The output directory mirrors this structure and is ready to serve
from any static HTTP server (with COOP/COEP headers, handled by sw.js).
Users who want custom HTML can edit index.html in the output directory.
"""

import argparse
import json
import os
import re
import shutil
import sys
import zipfile

# Files relative to the runtime build directory
RUNTIME_FILES = [
    'index.html',
    'sw.js',
    'manifest.json',
    'webchugl/index.js',
    'webchugl/index.wasm',
    'webchugl/webchugl.js',
    'webchugl/audio-worklet-processor.js',
    'webchugl/jszip.min.js',
    'webchugl/chugl_logo_light.png',
    'webchugl/chugl_logo_dark.png',
]


def create_bundle(output_dir, code_dir, packages_dir=None):
    """Create bundle.zip from user code and optional packages."""
    files = []
    # Collect code files
    for root, dirs, filenames in os.walk(code_dir):
        for f in filenames:
            src = os.path.join(root, f)
            arcname = 'code/' + os.path.relpath(src, code_dir).replace('\\', '/')
            files.append((src, arcname))

    # Collect package files
    if packages_dir and os.path.isdir(packages_dir):
        for root, dirs, filenames in os.walk(packages_dir):
            for f in filenames:
                src = os.path.join(root, f)
                arcname = 'packages/' + os.path.relpath(src, packages_dir).replace('\\', '/')
                files.append((src, arcname))

    zip_path = os.path.join(output_dir, 'bundle.zip')
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for src, arcname in files:
            zf.write(src, arcname)

    return len(files)


def generate_manifest(title):
    """Generate a web app manifest."""
    return json.dumps({
        'name': title,
        'short_name': title[:12],
        'description': title + ' — a WebChuGL application.',
        'start_url': './',
        'display': 'standalone',
        'background_color': '#ffffff',
        'theme_color': '#000000',
        'icons': [{
            'src': 'webchugl/chugl_logo_light.png',
            'sizes': 'any',
            'type': 'image/png'
        }]
    }, indent=4)


def main():
    parser = argparse.ArgumentParser(description='Package a ChucK program for WebChuGL')
    parser.add_argument('--runtime', required=True, help='Pre-built WebChuGL runtime directory')
    parser.add_argument('--code', required=True, help='ChucK code directory (must contain main.ck)')
    parser.add_argument('--output', required=True, help='Output directory')
    parser.add_argument('--title', default='WebChuGL', help='Page title')
    parser.add_argument('--packages', default=None, help='ChuGin packages directory')
    args = parser.parse_args()

    # Validate
    if not os.path.isdir(args.runtime):
        print(f'Error: runtime directory not found: {args.runtime}')
        sys.exit(1)

    if not os.path.isfile(os.path.join(args.code, 'main.ck')):
        print(f'Error: main.ck not found in {args.code}')
        sys.exit(1)

    missing = [f for f in RUNTIME_FILES if not os.path.isfile(os.path.join(args.runtime, f))]
    if missing:
        print(f'Error: missing runtime files: {", ".join(missing)}')
        sys.exit(1)

    # Create output directories
    os.makedirs(args.output, exist_ok=True)
    os.makedirs(os.path.join(args.output, 'webchugl'), exist_ok=True)

    # 1. Copy runtime files (preserving directory structure)
    for f in RUNTIME_FILES:
        shutil.copy2(os.path.join(args.runtime, f), os.path.join(args.output, f))
    print(f'Copied {len(RUNTIME_FILES)} runtime files')

    # 2. Update title in index.html
    index_path = os.path.join(args.output, 'index.html')
    with open(index_path, 'r', encoding='utf-8') as f:
        html = f.read()
    html = re.sub(r'<title>.*?</title>', '<title>' + args.title + '</title>', html)
    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'Updated index.html title: "{args.title}"')

    # 3. Generate manifest.json
    with open(os.path.join(args.output, 'manifest.json'), 'w', encoding='utf-8') as f:
        f.write(generate_manifest(args.title))
    print('Generated manifest.json')

    # 4. Create bundle.zip
    count = create_bundle(args.output, args.code, args.packages)
    print(f'Created bundle.zip ({count} files)')

    print(f'\nDone! Output: {args.output}/')
    print('Serve with any HTTP server (sw.js handles COOP/COEP headers).')
    print('To customize the HTML, edit index.html in the output directory.')


if __name__ == '__main__':
    main()
