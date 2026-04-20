# WebChuGL Setup Script
# Clones dependencies, installs Emscripten SDK, and applies patches
#
# Usage: ./setup.ps1

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot

# Dependency versions
$CHUGL_REPO = "https://github.com/Oran2009/chugl.git"
$CHUGL_BRANCH = "webchugl"
$CHUGL_COMMIT = "08c81f80f6d75f2c61bcd0d7a2da9cead4eaa72e"

$CHUCK_REPO = "https://github.com/ccrma/chuck.git"
$CHUCK_COMMIT = "2f1dd3ef4e979c96ce7c96c288e28910e3a37a76"

$EMSDK_VERSION = "4.0.17"
# Pin emsdk orchestration scripts to a known commit for reproducibility
$EMSDK_COMMIT = "bb1c0642e7df86a7dee5abe8a0a98ac16ae9fd02"

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
    Write-Host "[chuck] Directory exists, checking commit..." -ForegroundColor Yellow
    Push-Location $ChuckDir
    $currentCommit = git rev-parse HEAD
    if ($currentCommit -ne $CHUCK_COMMIT) {
        Write-Host "[chuck] Warning: Current commit ($currentCommit) differs from expected ($CHUCK_COMMIT)" -ForegroundColor Red
        Write-Host "[chuck] You may need to: git fetch && git checkout $CHUCK_COMMIT" -ForegroundColor Red
    } else {
        Write-Host "[chuck] Already at pinned commit" -ForegroundColor Green
    }
    Pop-Location
} else {
    Write-Host "[chuck] Cloning from $CHUCK_REPO..." -ForegroundColor Yellow
    git clone --filter=blob:none $CHUCK_REPO $ChuckDir
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
        $firstLine = @($allLines)[0]
        if ($firstLine -notmatch [regex]::Escape($ExpectedVersion)) {
            throw "[emsdk] Version mismatch. Expected $ExpectedVersion, got: $firstLine"
        }
        Write-Host "[emsdk] Verified: $firstLine" -ForegroundColor Green
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
# Pre-fetch Emscripten ports
# ============================================================================
# Some MSYS2 Python builds fail to download Emscripten ports over HTTPS during
# the build, so we pre-seed the contrib.glfw3 port cache with curl here.

Write-Host ""
Write-Host "=== Pre-fetching Emscripten Ports ===" -ForegroundColor Cyan

$GlfwPortDir = Join-Path $EmsdkInstall "cache\ports\contrib.glfw3"
if (-not (Test-Path $GlfwPortDir)) {
    $GlfwPortUrl = "https://github.com/pongasoft/emscripten-glfw/releases/download/v3.4.0.20260301/emscripten-glfw3-3.4.0.20260301.zip"
    $GlfwPortZip = Join-Path $EmsdkInstall "cache\ports\contrib.glfw3.zip"
    $CachePortsDir = Join-Path $EmsdkInstall "cache\ports"

    Write-Host "[emscripten-glfw] Downloading contrib.glfw3 port..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $CachePortsDir -Force | Out-Null
    curl -L --fail -o $GlfwPortZip $GlfwPortUrl
    if ($LASTEXITCODE -ne 0) { throw "Failed to download contrib.glfw3 port" }

    # Verify download integrity
    $GlfwExpectedSha256 = "d7f96c31ae5433bae2950b36f79a03a74c892d132da291c262e10fdf267fe57b"
    $GlfwActualSha256 = (Get-FileHash $GlfwPortZip -Algorithm SHA256).Hash.ToLower()
    if ($GlfwActualSha256 -ne $GlfwExpectedSha256) {
        Write-Host "[emscripten-glfw] WARNING: SHA-256 mismatch for contrib.glfw3 port download" -ForegroundColor Yellow
        Write-Host "  Expected: $GlfwExpectedSha256" -ForegroundColor Yellow
        Write-Host "  Got:      $GlfwActualSha256" -ForegroundColor Yellow
        Write-Host "  If this is a new version, update GlfwExpectedSha256 in setup.ps1" -ForegroundColor Yellow
    }

    Write-Host "[emscripten-glfw] Extracting..." -ForegroundColor Yellow
    Expand-Archive -Path $GlfwPortZip -DestinationPath $GlfwPortDir -Force
    $GlfwPortUrl | Out-File -FilePath (Join-Path $GlfwPortDir ".emscripten_url") -Encoding ascii -NoNewline
    Write-Host "[emscripten-glfw] Port cached successfully" -ForegroundColor Green
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
Write-Host ""
