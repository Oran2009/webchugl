#!/usr/bin/env python3
"""Create bundle.zip from code/ and packages/ directories.

Usage: python create_bundle.py <build_dir>
"""

import zipfile, os, sys

build_dir = sys.argv[1]
os.chdir(build_dir)

files = []
for dirpath in ['code', 'packages']:
    if not os.path.isdir(dirpath):
        continue
    for root, dirs, filenames in os.walk(dirpath):
        for f in filenames:
            path = os.path.join(root, f).replace('\\', '/')
            files.append(path)

with zipfile.ZipFile('bundle.zip', 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
    for path in files:
        zf.write(path, path)

raw_size = sum(os.path.getsize(f) for f in files)
zip_size = os.path.getsize('bundle.zip')
ratio = (1 - zip_size / raw_size) * 100 if raw_size > 0 else 0
print(f'Created bundle.zip: {len(files)} files, {raw_size/1024/1024:.1f} MB -> {zip_size/1024/1024:.1f} MB ({ratio:.0f}% compression)')
