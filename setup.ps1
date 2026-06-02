# WebChuGL Setup Script
# Clones dependencies, installs Emscripten SDK, and applies patches
#
# Usage: ./setup.ps1

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot

# Dependency versions
$CHUGL_REPO = "https://github.com/Oran2009/chugl.git"
$CHUGL_BRANCH = "webchugl"
$CHUGL_COMMIT = "0c6902896babdd713f083dc9937871be1c8e91d5"

$CHUCK_REPO = "https://github.com/ccrma/chuck.git"
$CHUCK_TAG = "chuck-1.5.5.8"

$EMSDK_VERSION = "5.0.3"
# Pin emsdk orchestration scripts to a known commit for reproducibility
$EMSDK_COMMIT = "41190c21c662e9cc1962aea94e71cbae9fd2fc87"

Write-Host "=== WebChuGL Setup ===" -ForegroundColor Cyan
Write-Host ""

# ============================================================================
# Clone chugl
# ============================================================================
$ChuglDir = Join-Path $ProjectRoot "chugl"
if (Test-Path $ChuglDir) {
    Write-Host "[chugl] Directory exists, checking commit..." -ForegroundColor Yellow
    Push-Location $ChuglDir
    $currentCommit = git rev-parse HEAD
    if ($currentCommit -ne $CHUGL_COMMIT) {
        Write-Host "[chugl] Warning: Current commit ($currentCommit) differs from expected ($CHUGL_COMMIT)" -ForegroundColor Red
        Write-Host "[chugl] You may need to: git fetch && git checkout $CHUGL_COMMIT" -ForegroundColor Red
    } else {
        Write-Host "[chugl] Already at pinned commit" -ForegroundColor Green
    }
    Pop-Location
} else {
    Write-Host "[chugl] Cloning from $CHUGL_REPO..." -ForegroundColor Yellow
    git clone --filter=blob:none $CHUGL_REPO $ChuglDir
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
    Write-Host "[chuck] Directory exists, checking tag..." -ForegroundColor Yellow
    Push-Location $ChuckDir
    # Resolve the tag to a commit. `^{}` dereferences annotated tags to the
    # underlying commit object; `-q --verify` returns non-zero (and empty
    # output) if the tag is unknown locally instead of printing an error.
    $expected = git rev-parse -q --verify "$CHUCK_TAG^{}" 2>$null
    if (-not $expected) {
        Write-Host "[chuck] tag '$CHUCK_TAG' not found locally; run: git fetch --tags" -ForegroundColor Red
    } else {
        $currentCommit = git rev-parse HEAD
        if ($currentCommit -ne $expected) {
            Write-Host "[chuck] Warning: Current commit ($currentCommit) differs from tag '$CHUCK_TAG' ($expected)" -ForegroundColor Red
            Write-Host "[chuck] You may need to: git fetch --tags && git checkout $CHUCK_TAG" -ForegroundColor Red
        } else {
            Write-Host "[chuck] Already at pinned tag $CHUCK_TAG" -ForegroundColor Green
        }
    }
    Pop-Location
} else {
    Write-Host "[chuck] Cloning from $CHUCK_REPO..." -ForegroundColor Yellow
    git clone --filter=blob:none $CHUCK_REPO $ChuckDir
    Push-Location $ChuckDir
    git checkout $CHUCK_TAG
    Pop-Location
    Write-Host "[chuck] Cloned and checked out $CHUCK_TAG" -ForegroundColor Green
}

# ============================================================================
# Install Emscripten SDK
# ============================================================================
$EmsdkDir = Join-Path $ProjectRoot "emsdk-$EMSDK_VERSION"
$EmsdkInstall = Join-Path $EmsdkDir "install\emscripten"

function Assert-EmsdkVersion {
    param([string]$InstallDir, [string]$ExpectedVersion)
    $emppPy = Join-Path $InstallDir "em++.py"
    if (-not (Test-Path $emppPy)) {
        throw "[emsdk] em++.py missing at $emppPy — install is corrupt"
    }
    $savedPython = $env:EMSDK_PYTHON; $env:EMSDK_PYTHON = ""
    try {
        # Capture full output before slicing — piping to Select-Object -First 1
        # terminates the upstream process early and produces a bogus LASTEXITCODE.
        $allLines = py $emppPy --version 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "[emsdk] em++ --version failed: $allLines"
        }
        $versionLine = @($allLines) | Where-Object { $_ -match [regex]::Escape($ExpectedVersion) } | Select-Object -First 1
        if (-not $versionLine) {
            throw "[emsdk] Version mismatch. Expected $ExpectedVersion, got: $($allLines -join '; ')"
        }
        Write-Host "[emsdk] Verified: $versionLine" -ForegroundColor Green
    } finally {
        $env:EMSDK_PYTHON = $savedPython
    }
}

if (Test-Path $EmsdkInstall) {
    Write-Host "[emsdk] Emscripten $EMSDK_VERSION already installed" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "=== Installing Emscripten SDK $EMSDK_VERSION ===" -ForegroundColor Cyan

    # Clone emsdk if needed (pinned to known commit for reproducibility)
    if (-not (Test-Path $EmsdkDir)) {
        Write-Host "[emsdk] Cloning emsdk..." -ForegroundColor Yellow
        git clone --filter=blob:none https://github.com/emscripten-core/emsdk.git $EmsdkDir
        Push-Location $EmsdkDir
        git checkout $EMSDK_COMMIT
        Pop-Location
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

Assert-EmsdkVersion -InstallDir $EmsdkInstall -ExpectedVersion $EMSDK_VERSION

# ============================================================================
# Done
# ============================================================================
Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  cd src/scripts" -ForegroundColor Gray
Write-Host "  ./build.ps1       # or ./build.sh on Unix" -ForegroundColor Gray
Write-Host ""
