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
    py (Join-Path $ScriptDir "fetch_packages.py") "$PackagesJson" "$BuildPackagesDir"
    if ($LASTEXITCODE -ne 0) { Write-Host "WARNING: Package fetch failed" -ForegroundColor Yellow }
}

# Create bundle.zip containing code/ and packages/ directories
Write-Host "Creating bundle.zip..." -ForegroundColor Yellow
py (Join-Path $ScriptDir "create_bundle.py") "$BuildDir"
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

# Minify JS assets
Write-Host "Minifying JS..." -ForegroundColor Gray
py (Join-Path $ScriptDir "minify_js.py") (Join-Path $BuildDir "webchugl" "webchugl.js")

# Clean up build artifacts (keep only files needed for web serving)
Write-Host "Cleaning build directory..." -ForegroundColor Gray
$cleanDirs = @("CMakeFiles", "freetype_build", "code", "packages")
foreach ($d in $cleanDirs) {
    $p = Join-Path $BuildDir $d
    if (Test-Path $p) { Remove-Item -Recurse -Force $p }
}
$cleanFiles = @("cmake_install.cmake", "CMakeCache.txt", "Makefile", ".ninja_deps", ".ninja_log", "build.ninja", "CPackConfig.cmake", "CPackSourceConfig.cmake")
foreach ($f in $cleanFiles) {
    $p = Join-Path $BuildDir $f
    if (Test-Path $p) { Remove-Item -Force $p }
}

Write-Host "`n=== Build Complete ===" -ForegroundColor Green
Write-Host "Output: $BuildDir/index.html" -ForegroundColor Gray
Write-Host "`nTo serve: ./scripts/dev.ps1" -ForegroundColor Cyan
