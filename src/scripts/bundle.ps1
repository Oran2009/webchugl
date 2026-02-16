# Bundle WebChuGL code and packages into bundle.zip
# Usage: ./bundle.ps1
#
# Copies src/code/ into the build directory, fetches ChuMP packages,
# and creates bundle.zip. Does NOT recompile WASM.

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$SrcDir = Split-Path -Parent $ScriptDir
$BuildDir = Join-Path $SrcDir "build"
$CodeDir = Join-Path $SrcDir "code"
$PyDir = Join-Path $ScriptDir "py"

Write-Host "=== Bundling ===" -ForegroundColor Cyan

# Copy code directory to build/code/
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
    py (Join-Path $PyDir "fetch_packages.py") "$PackagesJson" "$BuildPackagesDir"
    if ($LASTEXITCODE -ne 0) { Write-Host "WARNING: Package fetch failed" -ForegroundColor Yellow }
}

# Create bundle.zip
Write-Host "Creating bundle.zip..." -ForegroundColor Yellow
py (Join-Path $PyDir "create_bundle.py") "$BuildDir"
if ($LASTEXITCODE -ne 0) { throw "Bundle creation failed" }

# Clean up source directories (already in bundle.zip)
foreach ($d in @("code", "packages")) {
    $p = Join-Path $BuildDir $d
    if (Test-Path $p) { Remove-Item -Recurse -Force $p }
}

Write-Host "`n=== Bundle Complete ===" -ForegroundColor Green
