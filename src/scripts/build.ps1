# Build WebChuGL
# Usage: ./build.ps1 [-Clean]

param(
    [switch]$Clean,
    [int]$Jobs = 8
)

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$SrcDir = Split-Path -Parent $ScriptDir
$BuildDir = Join-Path $SrcDir "build"
$EmsdkDir = Join-Path (Split-Path -Parent $SrcDir) "emsdk-3.1.61\install\emscripten"
$EmCMake = Join-Path $EmsdkDir "emcmake.py"
$EmMake = Join-Path $EmsdkDir "emmake.py"

Write-Host "=== Building WebChuGL ===" -ForegroundColor Cyan

# Clean if requested
if ($Clean -and (Test-Path $BuildDir)) {
    Write-Host "Cleaning build directory..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $BuildDir
}

# Create build directory
if (-not (Test-Path $BuildDir)) {
    New-Item -ItemType Directory -Path $BuildDir | Out-Null
}

# Copy code directory to build/code/ (preserving structure for /code/main.ck path)
$CodeDir = Join-Path $SrcDir "code"
$BuildCodeDir = Join-Path $BuildDir "code"
if (Test-Path $CodeDir) {
    if (Test-Path $BuildCodeDir) {
        Remove-Item -Recurse -Force $BuildCodeDir
    }
    Copy-Item $CodeDir $BuildCodeDir -Recurse -Force
    Write-Host "Copied code/ to build/code/" -ForegroundColor Gray
}

# Fetch ChuMP packages if packages.json exists
$PackagesJson = Join-Path $CodeDir "packages.json"
$BuildPackagesDir = Join-Path $BuildDir "packages"
if (Test-Path $PackagesJson) {
    Write-Host "Fetching ChuMP packages..." -ForegroundColor Yellow
    $fetchScript = @"
import json, urllib.request, zipfile, io, os, shutil, sys, glob

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
"@
    py -c $fetchScript "$PackagesJson" "$BuildPackagesDir"
    if ($LASTEXITCODE -ne 0) { Write-Host "WARNING: Package fetch failed" -ForegroundColor Yellow }
}

# Create bundle.zip containing code/ and packages/ directories
Write-Host "Creating bundle.zip..." -ForegroundColor Yellow
$bundleScript = @"
import zipfile, os, sys

os.chdir(sys.argv[1])

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
"@
py -c $bundleScript "$BuildDir"
if ($LASTEXITCODE -ne 0) { throw "Bundle creation failed" }

# Configure
$CMakeCacheFile = Join-Path $BuildDir "CMakeCache.txt"
if (-not (Test-Path $CMakeCacheFile)) {
    Write-Host "Configuring with CMake..." -ForegroundColor Yellow
    Push-Location $BuildDir
    try {
        $env:EMSDK_PYTHON = ""
        py $EmCMake cmake .. -DCMAKE_POLICY_VERSION_MINIMUM="3.5"
        if ($LASTEXITCODE -ne 0) { throw "CMake configuration failed" }
    } finally {
        Pop-Location
    }
}

# Build
Write-Host "Building WASM..." -ForegroundColor Yellow
Push-Location $BuildDir
try {
    $env:EMSDK_PYTHON = ""
    py $EmMake make -j $Jobs
    if ($LASTEXITCODE -ne 0) { throw "Build failed" }
} finally {
    Pop-Location
}

# Clean up build artifacts (keep only files needed for web serving)
Write-Host "Cleaning build directory..." -ForegroundColor Gray
$cleanDirs = @("CMakeFiles", "freetype_build", "code", "packages")
foreach ($d in $cleanDirs) {
    $p = Join-Path $BuildDir $d
    if (Test-Path $p) { Remove-Item -Recurse -Force $p }
}
$cleanFiles = @("cmake_install.cmake", "CMakeCache.txt", "Makefile", ".ninja_deps", ".ninja_log", "build.ninja", "manifest.json", "CPackConfig.cmake", "CPackSourceConfig.cmake")
foreach ($f in $cleanFiles) {
    $p = Join-Path $BuildDir $f
    if (Test-Path $p) { Remove-Item -Force $p }
}

Write-Host "`n=== Build Complete ===" -ForegroundColor Green
Write-Host "Output: $BuildDir/index.html" -ForegroundColor Gray
Write-Host "`nTo test: python scripts/serve.py" -ForegroundColor Cyan
