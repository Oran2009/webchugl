#!/usr/bin/env python3
"""Fetch ChuMP packages listed in packages.json.

Usage: python fetch_packages.py <packages_json> <output_dir>

packages.json format:
  {"packages": [
    {"name": "ChuGUI", "version": "0.1.3"},
    {"name": "HashMap", "version": "1.0.0"},
    {"name": "Custom", "version": "1.0", "url": "https://example.com/custom.zip"}
  ]}

If 'url' is provided, it is used directly. Otherwise the URL is resolved
from the ChuMP registry at github.com/ccrma/chump-packages.
"""

import json, urllib.request, ssl, zipfile, io, os, shutil, sys, glob

CHUMP_RAW = 'https://raw.githubusercontent.com/ccrma/chump-packages/main/packages'

packages_json = sys.argv[1]
output_dir = sys.argv[2]

with open(packages_json) as f:
    config = json.load(f)

os.makedirs(output_dir, exist_ok=True)


def url_read(url):
    """Download URL content, retrying with SSL verification disabled on failure."""
    try:
        return urllib.request.urlopen(url).read()
    except urllib.error.URLError:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return urllib.request.urlopen(url, context=ctx).read()


def resolve_chump_url(name, version):
    """Resolve a package's download URL from the ChuMP registry."""
    candidates = [
        f'{CHUMP_RAW}/{name}/{version}/{name}.json',
    ]
    for manifest_url in candidates:
        try:
            data = json.loads(url_read(manifest_url))
            files = data.get('files', [])
            for f in files:
                if f.get('url'):
                    return f['url']
        except Exception:
            continue
    return None


for pkg in config.get('packages', []):
    name = pkg['name']
    version = pkg['version']
    pkg_dir = os.path.join(output_dir, name)

    # Skip if already fetched
    if os.path.isdir(pkg_dir):
        print(f'  {name} {version} (cached)')
        continue

    print(f'  Fetching {name} {version}...')

    # Resolve download URL: explicit in packages.json, or from ChuMP registry
    zip_url = pkg.get('url')
    if not zip_url:
        zip_url = resolve_chump_url(name, version)
        if not zip_url:
            print(f'  ERROR: Could not resolve URL for {name} {version} from ChuMP registry')
            continue

    try:
        zip_data = url_read(zip_url)
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
