# WebChuGL dev server — fast iteration on HTML + ChucK code
# Usage: ./dev.ps1 [port]
# Requires: initial build via build.ps1

param(
    [int]$Port = 8080
)

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$SrcDir = Split-Path -Parent $ScriptDir
$BuildDir = Join-Path $SrcDir "build"

# Validate prerequisites
if (-not (Test-Path (Join-Path $BuildDir "index.js")) -or
    -not (Test-Path (Join-Path $BuildDir "index.wasm"))) {
    Write-Host "Error: build/index.js or index.wasm not found." -ForegroundColor Red
    Write-Host "Run build.ps1 first to do the initial C++ compilation." -ForegroundColor Yellow
    exit 1
}

Write-Host "Starting WebChuGL dev server..." -ForegroundColor Cyan
Write-Host "Watching src/code/ and src/web/ for changes" -ForegroundColor Gray
Write-Host ""

py (Join-Path $ScriptDir "dev_server.py") $Port
