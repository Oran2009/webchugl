#!/usr/bin/env python3
"""Fetch ChuMP packages listed in packages.json.

Usage: python fetch_packages.py <packages_json> <output_dir>
"""

import json, urllib.request, ssl, zipfile, io, os, shutil, sys, glob

packages_json = sys.argv[1]
output_dir = sys.argv[2]

with open(packages_json) as f:
    config = json.load(f)

os.makedirs(output_dir, exist_ok=True)

for pkg in config.get('packages', []):
    name = pkg['name']
    version = pkg['version']
    pkg_dir = os.path.join(output_dir, name)

    # Skip if already fetched
    if os.path.isdir(pkg_dir):
        print(f'  {name} {version} (cached)')
        continue

    print(f'  Fetching {name} {version}...')

    # Download ZIP from URL specified in packages.json
    zip_url = pkg.get('url')
    if not zip_url:
        print(f'  ERROR: No url specified for {name}')
        continue
    try:
        zip_data = urllib.request.urlopen(zip_url).read()
    except urllib.error.URLError:
        # Retry with SSL verification disabled (some servers use self-signed certs)
        try:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            zip_data = urllib.request.urlopen(zip_url, context=ctx).read()
        except Exception as e:
            print(f'  ERROR: Could not download {name}: {e}')
            continue

    # Extract to packages/<name>/
    os.makedirs(pkg_dir, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
        zf.extractall(pkg_dir)

    # Strip non-essential directories
    for strip_dir in ['examples', '_examples', 'scripts', 'releases', '.git']:
        strip_path = os.path.join(pkg_dir, strip_dir)
        if os.path.isdir(strip_path):
            shutil.rmtree(strip_path)

    # Strip non-essential files
    for pattern in ['README*', 'VERSIONS', 'imgui.ini', '*.md']:
        for match in glob.glob(os.path.join(pkg_dir, pattern)):
            if os.path.isfile(match):
                os.remove(match)

    print(f'  Installed {name} {version}')
