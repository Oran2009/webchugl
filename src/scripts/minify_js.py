#!/usr/bin/env python3
"""Basic JS minifier — strips comments and collapses whitespace.

Usage: python minify_js.py <file.js> [file2.js ...]
Minifies files in-place.
"""

import re, sys

for path in sys.argv[1:]:
    with open(path) as f:
        s = f.read()
    # Strip multi-line comments
    s = re.sub(r'/\*.*?\*/', '', s, flags=re.DOTALL)
    # Strip single-line comments (but not URLs like http://)
    s = re.sub(r'(?<![:\'"])//[^\n]*', '', s)
    # Collapse runs of blank lines
    s = re.sub(r'\n\s*\n', '\n', s)
    # Strip trailing whitespace per line
    s = re.sub(r'[ \t]+$', '', s, flags=re.MULTILINE)
    s = s.strip() + '\n'
    with open(path, 'w') as f:
        f.write(s)
    print(f'  Minified {path}')
