# WebChuGL Setup Script
# Clones dependencies and applies patches for WebChuGL development
#
# Usage: ./setup.ps1

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot

# Dependency versions (commits that patches apply to)
$CHUGL_REPO = "https://github.com/ccrma/chugl.git"
$CHUGL_COMMIT = "9d6245a"

$CHUCK_REPO = "https://github.com/ccrma/chuck.git"
$CHUCK_COMMIT = "60caede9"

Write-Host "=== WebChuGL Setup ===" -ForegroundColor Cyan
Write-Host ""

# Clone or update chugl
$ChuglDir = Join-Path $ProjectRoot "chugl"
if (Test-Path $ChuglDir) {
    Write-Host "[chugl] Directory exists, checking commit..." -ForegroundColor Yellow
    Push-Location $ChuglDir
    $currentCommit = git rev-parse --short HEAD
    if ($currentCommit -ne $CHUGL_COMMIT.Substring(0,7)) {
        Write-Host "[chugl] Warning: Current commit ($currentCommit) differs from expected ($CHUGL_COMMIT)" -ForegroundColor Red
        Write-Host "[chugl] You may need to: git checkout $CHUGL_COMMIT" -ForegroundColor Red
    } else {
        Write-Host "[chugl] Already at correct commit" -ForegroundColor Green
    }
    Pop-Location
} else {
    Write-Host "[chugl] Cloning from $CHUGL_REPO..." -ForegroundColor Yellow
    git clone $CHUGL_REPO $ChuglDir
    Push-Location $ChuglDir
    git checkout $CHUGL_COMMIT
    Pop-Location
    Write-Host "[chugl] Cloned and checked out $CHUGL_COMMIT" -ForegroundColor Green
}

# Clone or update chuck
$ChuckDir = Join-Path $ProjectRoot "chuck"
if (Test-Path $ChuckDir) {
    Write-Host "[chuck] Directory exists, checking commit..." -ForegroundColor Yellow
    Push-Location $ChuckDir
    $currentCommit = git rev-parse --short HEAD
    if ($currentCommit -ne $CHUCK_COMMIT.Substring(0,7)) {
        Write-Host "[chuck] Warning: Current commit ($currentCommit) differs from expected ($CHUCK_COMMIT)" -ForegroundColor Red
        Write-Host "[chuck] You may need to: git checkout $CHUCK_COMMIT" -ForegroundColor Red
    } else {
        Write-Host "[chuck] Already at correct commit" -ForegroundColor Green
    }
    Pop-Location
} else {
    Write-Host "[chuck] Cloning from $CHUCK_REPO..." -ForegroundColor Yellow
    git clone $CHUCK_REPO $ChuckDir
    Push-Location $ChuckDir
    git checkout $CHUCK_COMMIT
    Pop-Location
    Write-Host "[chuck] Cloned and checked out $CHUCK_COMMIT" -ForegroundColor Green
}

# Apply patches
$PatchDir = Join-Path $ProjectRoot "patches"

Write-Host ""
Write-Host "=== Applying Patches ===" -ForegroundColor Cyan

# Apply chugl patch
$ChuglPatch = Join-Path $PatchDir "chugl.patch"
if (Test-Path $ChuglPatch) {
    Write-Host "[chugl] Applying patch..." -ForegroundColor Yellow
    Push-Location $ChuglDir
    git apply --check $ChuglPatch 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        git apply $ChuglPatch
        Write-Host "[chugl] Patch applied successfully" -ForegroundColor Green
    } else {
        Write-Host "[chugl] Patch already applied or conflicts exist" -ForegroundColor Yellow
    }
    Pop-Location
}

# Apply chuck patch
$ChuckPatch = Join-Path $PatchDir "chuck.patch"
if (Test-Path $ChuckPatch) {
    Write-Host "[chuck] Applying patch..." -ForegroundColor Yellow
    Push-Location $ChuckDir
    git apply --check $ChuckPatch 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        git apply $ChuckPatch
        Write-Host "[chuck] Patch applied successfully" -ForegroundColor Green
    } else {
        Write-Host "[chuck] Patch already applied or conflicts exist" -ForegroundColor Yellow
    }
    Pop-Location
}

Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Install Emscripten SDK to emsdk-3.1.61/" -ForegroundColor Gray
Write-Host "  2. cd src && ./build.ps1" -ForegroundColor Gray
Write-Host "  3. python serve.py" -ForegroundColor Gray
Write-Host ""
