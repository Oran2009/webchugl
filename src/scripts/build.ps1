# Build WebChuGL (WASM compilation only)
# Usage: ./build.ps1 [-Clean] [-Jobs N]
#
# This only compiles C++/WASM. To bundle code/packages into bundle.zip,
# run bundle.ps1 separately (or use build-and-bundle.ps1 for both).
#
# CMake builds in src/.cmake-build/ (outside build/) so that build/
# contains only web-deployable files.

param(
    [switch]$Clean,
    [int]$Jobs = 8
)

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$SrcDir = Split-Path -Parent $ScriptDir
$BuildDir = Join-Path $SrcDir "build"
$CMakeBuildDir = Join-Path $SrcDir ".cmake-build"
$EmsdkDir = Join-Path (Split-Path -Parent $SrcDir) "emsdk-3.1.61\install\emscripten"
$EmCMake = Join-Path $EmsdkDir "emcmake.py"
$EmMake = Join-Path $EmsdkDir "emmake.py"

Write-Host "=== Building WebChuGL ===" -ForegroundColor Cyan

# Clean if requested
if ($Clean) {
    foreach ($d in @($BuildDir, $CMakeBuildDir)) {
        if (Test-Path $d) {
            Write-Host "Cleaning $d..." -ForegroundColor Yellow
            Remove-Item -Recurse -Force $d
        }
    }
}

# Create directories
foreach ($d in @($BuildDir, $CMakeBuildDir)) {
    if (-not (Test-Path $d)) {
        New-Item -ItemType Directory -Path $d | Out-Null
    }
}

# Configure
$CMakeCacheFile = Join-Path $CMakeBuildDir "CMakeCache.txt"
if (-not (Test-Path $CMakeCacheFile)) {
    Write-Host "Configuring with CMake..." -ForegroundColor Yellow
    Push-Location $CMakeBuildDir
    try {
        $env:EMSDK_PYTHON = ""
        py $EmCMake cmake "$SrcDir" -DCMAKE_POLICY_VERSION_MINIMUM="3.5"
        if ($LASTEXITCODE -ne 0) { throw "CMake configuration failed" }
    } finally {
        Pop-Location
    }
}

# Build
Write-Host "Building WASM..." -ForegroundColor Yellow
Push-Location $CMakeBuildDir
try {
    $env:EMSDK_PYTHON = ""
    py $EmMake make -j $Jobs
    if ($LASTEXITCODE -ne 0) { throw "Build failed" }
} finally {
    Pop-Location
}

# Copy web outputs to build/
Write-Host "Copying web outputs..." -ForegroundColor Gray
foreach ($f in @("index.html", "index.worker.js", "sw.js", "manifest.json")) {
    $src = Join-Path $CMakeBuildDir $f
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $BuildDir $f) -Force
    }
}
$CMakeWebchuglDir = Join-Path $CMakeBuildDir "webchugl"
$BuildWebchuglDir = Join-Path $BuildDir "webchugl"
if (Test-Path $CMakeWebchuglDir) {
    if (-not (Test-Path $BuildWebchuglDir)) {
        New-Item -ItemType Directory -Path $BuildWebchuglDir | Out-Null
    }
    Copy-Item (Join-Path $CMakeWebchuglDir "*") $BuildWebchuglDir -Recurse -Force
}

# Minify JS assets
Write-Host "Minifying JS..." -ForegroundColor Gray
py (Join-Path $ScriptDir "py\minify_js.py") (Join-Path $BuildWebchuglDir "webchugl.js")

Write-Host "`n=== Build Complete ===" -ForegroundColor Green
Write-Host "Output: $BuildDir" -ForegroundColor Gray
Write-Host "`nNext: ./scripts/bundle.ps1 (to create bundle.zip)" -ForegroundColor Cyan
