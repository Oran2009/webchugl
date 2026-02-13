# WebChuGL dev server — fast iteration on HTML + ChucK code
# Usage: ./dev.ps1 [port]
# Requires: initial build via build.ps1

param(
    [int]$Port = 8080
)

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot

Write-Host "Starting WebChuGL dev server..." -ForegroundColor Cyan
Write-Host "Watching src/code/ and src/web/ for changes" -ForegroundColor Gray
Write-Host ""

py (Join-Path $ScriptDir "dev_server.py") $Port
