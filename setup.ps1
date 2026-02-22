# WebChuGL Setup Script
# Clones dependencies, installs Emscripten SDK, and applies patches
#
# Usage: ./setup.ps1

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot

# Dependency versions
$CHUGL_REPO = "https://github.com/Oran2009/chugl.git"
$CHUGL_BRANCH = "webchugl"

$CHUCK_REPO = "https://github.com/ccrma/chuck.git"
$CHUCK_COMMIT = "60caede9"  # short SHA; git checkout handles prefix matching

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
    Write-Host "[chugl] Directory exists, checking branch..." -ForegroundColor Yellow
    Push-Location $ChuglDir
    $currentBranch = git rev-parse --abbrev-ref HEAD
    if ($currentBranch -ne $CHUGL_BRANCH) {
        Write-Host "[chugl] Warning: Current branch ($currentBranch) differs from expected ($CHUGL_BRANCH)" -ForegroundColor Red
        Write-Host "[chugl] You may need to: git checkout $CHUGL_BRANCH" -ForegroundColor Red
    } else {
        Write-Host "[chugl] Already on branch $CHUGL_BRANCH" -ForegroundColor Green
    }
    Pop-Location
} else {
    Write-Host "[chugl] Cloning from $CHUGL_REPO (branch: $CHUGL_BRANCH)..." -ForegroundColor Yellow
    git clone --filter=blob:none -b $CHUGL_BRANCH $CHUGL_REPO $ChuglDir
    Write-Host "[chugl] Cloned branch $CHUGL_BRANCH" -ForegroundColor Green
}

# ============================================================================
# Clone chuck
# ============================================================================
$ChuckDir = Join-Path $ProjectRoot "chuck"
if (Test-Path $ChuckDir) {
    Write-Host "[chuck] Directory exists, checking commit..." -ForegroundColor Yellow
    Push-Location $ChuckDir
    $currentCommit = git rev-parse --short=8 HEAD
    if ($currentCommit -ne $CHUCK_COMMIT.Substring(0,8)) {
        Write-Host "[chuck] Warning: Current commit ($currentCommit) differs from expected ($CHUCK_COMMIT)" -ForegroundColor Red
        Write-Host "[chuck] You may need to: git checkout $CHUCK_COMMIT" -ForegroundColor Red
    } else {
        Write-Host "[chuck] Already at correct commit" -ForegroundColor Green
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

# ============================================================================
# Apply patches
# ============================================================================
$PatchDir = Join-Path $ProjectRoot "patches"

Write-Host ""
Write-Host "=== Applying Patches ===" -ForegroundColor Cyan

# Apply emscripten-glfw patch (contrib.glfw3 port)
$GlfwPatch = Join-Path $PatchDir "emscripten-glfw.patch"
$GlfwPortDir = Join-Path $EmsdkInstall "cache\ports\contrib.glfw3"
if (Test-Path $GlfwPatch) {
    # Pre-fetch the port if not already cached (use curl to avoid MSYS2 Python SSL issues)
    if (-not (Test-Path $GlfwPortDir)) {
        $GlfwPortUrl = "https://github.com/pongasoft/emscripten-glfw/releases/download/v3.4.0.20250927/emscripten-glfw3-3.4.0.20250927.zip"
        $GlfwPortZip = Join-Path $EmsdkInstall "cache\ports\contrib.glfw3.zip"
        $CachePortsDir = Join-Path $EmsdkInstall "cache\ports"

        Write-Host "[emscripten-glfw] Downloading contrib.glfw3 port..." -ForegroundColor Yellow
        New-Item -ItemType Directory -Path $CachePortsDir -Force | Out-Null
        curl -L --fail -o $GlfwPortZip $GlfwPortUrl
        if ($LASTEXITCODE -ne 0) { throw "Failed to download contrib.glfw3 port" }

        # Verify download integrity
        $GlfwExpectedSha256 = "c0d3fc0b0e4fea44c72e2e5a657c55924c68b60d2e984b8b3e82f42914ba0980"
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

    if (Test-Path $GlfwPortDir) {
        $GlfwJsFile = Join-Path $GlfwPortDir "src\js\lib_emscripten_glfw3.js"
        $PatchMarker = "Re-register MQL with current DPR"
        if ((Test-Path $GlfwJsFile) -and -not (Select-String -Path $GlfwJsFile -Pattern $PatchMarker -Quiet)) {
            Write-Host "[emscripten-glfw] Applying patch..." -ForegroundColor Yellow
            Push-Location $GlfwPortDir
            patch -p1 -i $GlfwPatch
            Pop-Location
            Write-Host "[emscripten-glfw] Patch applied successfully" -ForegroundColor Green
        } else {
            Write-Host "[emscripten-glfw] Patch already applied" -ForegroundColor Green
        }
    } else {
        Write-Host "[emscripten-glfw] Warning: Port not found, patch will be applied during build" -ForegroundColor Yellow
    }
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
