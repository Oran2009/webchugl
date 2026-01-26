# Build WebChuGL
# Usage: ./build.ps1 [-Clean]

param(
    [switch]$Clean,
    [int]$Jobs = 8
)

$ErrorActionPreference = "Stop"

$HostWebDir = $PSScriptRoot
$BuildDir = Join-Path $HostWebDir "build"
$EmsdkDir = Join-Path (Split-Path -Parent (Split-Path -Parent $HostWebDir)) "emsdk-3.1.61\install\emscripten"
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

# Configure
$CMakeCacheFile = Join-Path $BuildDir "CMakeCache.txt"
if (-not (Test-Path $CMakeCacheFile)) {
    Write-Host "Configuring with CMake..." -ForegroundColor Yellow
    Push-Location $BuildDir
    try {
        $env:EMSDK_PYTHON = ""
        py $EmCMake cmake ..
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

# Copy program.ck to build directory if it exists
$ProgramCk = Join-Path $HostWebDir "program.ck"
if (Test-Path $ProgramCk) {
    Copy-Item $ProgramCk (Join-Path $BuildDir "program.ck") -Force
    Write-Host "Copied program.ck to build directory" -ForegroundColor Gray
}

Write-Host "`nTo test: python serve.py" -ForegroundColor Cyan
