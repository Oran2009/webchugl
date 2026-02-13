# WebChuGL Setup Script
# Clones dependencies, installs Emscripten SDK, and applies patches
#
# Usage: ./setup.ps1

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot

# Dependency versions
$CHUGL_REPO = "https://github.com/ccrma/chugl.git"
$CHUGL_COMMIT = "9d6245a"

$CHUCK_REPO = "https://github.com/ccrma/chuck.git"
$CHUCK_COMMIT = "60caede9"

$EMSDK_VERSION = "3.1.61"

Write-Host "=== WebChuGL Setup ===" -ForegroundColor Cyan
Write-Host ""

# ============================================================================
# Clone chugl
# ============================================================================
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

# ============================================================================
# Clone chuck
# ============================================================================
$ChuckDir = Join-Path $ProjectRoot "chuck"
if (Test-Path $ChuckDir) {
    Write-Host "[chuck] Directory exists, checking commit..." -ForegroundColor Yellow
    Push-Location $ChuckDir
    $currentCommit = git rev-parse --short HEAD
    if ($currentCommit -ne $CHUCK_COMMIT.Substring(0,8)) {
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

# ============================================================================
# Install Emscripten SDK
# ============================================================================
$EmsdkDir = Join-Path $ProjectRoot "emsdk-$EMSDK_VERSION"
$EmsdkInstall = Join-Path $EmsdkDir "install\emscripten"

if (Test-Path $EmsdkInstall) {
    Write-Host "[emsdk] Emscripten $EMSDK_VERSION already installed" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "=== Installing Emscripten SDK $EMSDK_VERSION ===" -ForegroundColor Cyan

    # Clone emsdk if needed
    if (-not (Test-Path $EmsdkDir)) {
        Write-Host "[emsdk] Cloning emsdk..." -ForegroundColor Yellow
        git clone https://github.com/emscripten-core/emsdk.git $EmsdkDir
    }

    Push-Location $EmsdkDir

    Write-Host "[emsdk] Installing version $EMSDK_VERSION..." -ForegroundColor Yellow
    if ($IsWindows -or $env:OS -eq "Windows_NT") {
        .\emsdk.bat install $EMSDK_VERSION
    } else {
        ./emsdk install $EMSDK_VERSION
    }

    Write-Host "[emsdk] Activating version $EMSDK_VERSION..." -ForegroundColor Yellow
    if ($IsWindows -or $env:OS -eq "Windows_NT") {
        .\emsdk.bat activate $EMSDK_VERSION
    } else {
        ./emsdk activate $EMSDK_VERSION
    }

    # Move to install subdirectory for cleaner structure
    $UpstreamEmscripten = Join-Path $EmsdkDir "upstream\emscripten"
    if (Test-Path $UpstreamEmscripten) {
        $InstallDir = Join-Path $EmsdkDir "install"
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        Move-Item $UpstreamEmscripten $InstallDir -Force
        Write-Host "[emsdk] Moved emscripten to install/" -ForegroundColor Gray
    }

    Pop-Location
    Write-Host "[emsdk] Emscripten $EMSDK_VERSION installed successfully" -ForegroundColor Green
}

# ============================================================================
# Apply patches
# ============================================================================
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
        Write-Host "[chugl] Resetting and reapplying patch..." -ForegroundColor Yellow
        git checkout .
        git apply $ChuglPatch
        Write-Host "[chugl] Patch applied successfully" -ForegroundColor Green
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
        Write-Host "[chuck] Resetting and reapplying patch..." -ForegroundColor Yellow
        git checkout .
        git apply $ChuckPatch
        Write-Host "[chuck] Patch applied successfully" -ForegroundColor Green
    }
    Pop-Location
}

# ============================================================================
# Done
# ============================================================================
Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  cd src/scripts" -ForegroundColor Gray
Write-Host "  ./build.ps1       # or ./build.sh on Unix" -ForegroundColor Gray
Write-Host "  ./dev.ps1" -ForegroundColor Gray
Write-Host ""
