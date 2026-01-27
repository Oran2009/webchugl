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

# Copy all files from code directory to build directory (before build so they're available)
$CodeDir = Join-Path $SrcDir "code"
if (Test-Path $CodeDir) {
    Copy-Item "$CodeDir\*" $BuildDir -Recurse -Force
    Write-Host "Copied code/ to build directory" -ForegroundColor Gray
}

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

Write-Host "`n=== Build Complete ===" -ForegroundColor Green
Write-Host "Output: $BuildDir/index.html" -ForegroundColor Gray
Write-Host "`nTo test: python scripts/serve.py" -ForegroundColor Cyan
