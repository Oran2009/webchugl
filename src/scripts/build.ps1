# Build WebChuGL (WASM compilation)
# Usage: ./build.ps1 [-Clean] [-Jobs N]
#
# CMake builds in src/.cmake-build/ (outside build/) so that build/
# contains only web-deployable files.

param(
    [switch]$Clean,
    [int]$Jobs = 8
)

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$SrcDir = Split-Path -Parent $ScriptDir
$BuildDir = Join-Path $SrcDir "build"
$CMakeBuildDir = Join-Path $SrcDir ".cmake-build"
$ProjectRoot = Split-Path -Parent $SrcDir
$EmsdkDir = (Get-ChildItem -Path $ProjectRoot -Directory -Filter "emsdk-*" | Select-Object -First 1).FullName
if (-not $EmsdkDir) { throw "Emscripten SDK not found. Run setup.ps1 first." }
$EmsdkDir = Join-Path $EmsdkDir "install\emscripten"
$EmCMake = Join-Path $EmsdkDir "emcmake.py"
$EmMake = Join-Path $EmsdkDir "emmake.py"

$PatchDir = Join-Path $ProjectRoot "patches"

Write-Host "=== Building WebChuGL ===" -ForegroundColor Cyan

# Ensure emscripten-glfw patch is applied
$GlfwPatch = Join-Path $PatchDir "emscripten-glfw.patch"
$GlfwJsFile = Join-Path $EmsdkDir "cache\ports\contrib.glfw3\src\js\lib_emscripten_glfw3.js"
if ((Test-Path $GlfwPatch) -and (Test-Path $GlfwJsFile)) {
    if (-not (Select-String -Path $GlfwJsFile -Pattern "Re-register MQL with current DPR" -Quiet)) {
        Write-Host "Applying emscripten-glfw patch..." -ForegroundColor Yellow
        Push-Location (Join-Path $EmsdkDir "cache\ports\contrib.glfw3")
        patch -p1 -i $GlfwPatch
        Pop-Location
    }
}

# Clean if requested
if ($Clean) {
    foreach ($d in @($BuildDir, $CMakeBuildDir)) {
        if (Test-Path $d) {
            Write-Host "Cleaning $d..." -ForegroundColor Yellow
            Remove-Item -Recurse -Force $d
        }
    }
}

# Create directories
foreach ($d in @($BuildDir, $CMakeBuildDir)) {
    if (-not (Test-Path $d)) {
        New-Item -ItemType Directory -Path $d | Out-Null
    }
}

# Configure
$CMakeCacheFile = Join-Path $CMakeBuildDir "CMakeCache.txt"
if (-not (Test-Path $CMakeCacheFile)) {
    Write-Host "Configuring with CMake..." -ForegroundColor Yellow
    Push-Location $CMakeBuildDir
    try {
        $savedPython = $env:EMSDK_PYTHON; $env:EMSDK_PYTHON = ""
        py $EmCMake cmake "$SrcDir" -DCMAKE_POLICY_VERSION_MINIMUM="3.5" -DCMAKE_BUILD_TYPE=Release
        if ($LASTEXITCODE -ne 0) { throw "CMake configuration failed" }
    } finally {
        $env:EMSDK_PYTHON = $savedPython
        Pop-Location
    }
}

# Build
Write-Host "Building WASM..." -ForegroundColor Yellow
Push-Location $CMakeBuildDir
try {
    $savedPython = $env:EMSDK_PYTHON; $env:EMSDK_PYTHON = ""
    py $EmMake make -j $Jobs
    if ($LASTEXITCODE -ne 0) { throw "Build failed" }
} finally {
    $env:EMSDK_PYTHON = $savedPython
    Pop-Location
}

# Copy web outputs to build/
Write-Host "Copying web outputs..." -ForegroundColor Gray
foreach ($f in @("index.html", "sw.js", "manifest.json")) {
    $src = Join-Path $CMakeBuildDir $f
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $BuildDir $f) -Force
    }
}
$CMakeWebchuglDir = Join-Path $CMakeBuildDir "webchugl"
$BuildWebchuglDir = Join-Path $BuildDir "webchugl"
if (Test-Path $CMakeWebchuglDir) {
    if (-not (Test-Path $BuildWebchuglDir)) {
        New-Item -ItemType Directory -Path $BuildWebchuglDir | Out-Null
    }
    Copy-Item (Join-Path $CMakeWebchuglDir "*") $BuildWebchuglDir -Recurse -Force
}

# Validate required build outputs exist
$requiredJs = Join-Path $BuildWebchuglDir "index.js"
$requiredWasm = Join-Path $BuildWebchuglDir "webchugl.wasm"
if (-not (Test-Path $requiredJs) -or -not (Test-Path $requiredWasm)) {
    throw "Build outputs missing. Expected webchugl/index.js and webchugl/webchugl.wasm in $BuildDir"
}

# Copy runtime to web/src/ (for website deployment)
Write-Host "Copying to web/src/..." -ForegroundColor Gray
$WebSrcDir = Join-Path $ProjectRoot "web\src"
if (-not (Test-Path $WebSrcDir)) {
    New-Item -ItemType Directory -Path $WebSrcDir | Out-Null
}
foreach ($f in @("index.js", "webchugl.wasm", "webchugl.js", "webchugl-esm.js",
                 "audio-worklet-processor.js", "jszip.min.js",
                 "chugl_logo_light.png", "chugl_logo_dark.png")) {
    $src = Join-Path $BuildWebchuglDir $f
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $WebSrcDir $f) -Force
    }
}
# sw.js goes one level up (web/) for broader scope
$swSrc = Join-Path $BuildDir "sw.js"
if (Test-Path $swSrc) {
    Copy-Item $swSrc (Join-Path $ProjectRoot "web\sw.js") -Force
}

# Copy ESM entry point to dist/ (for npm publishing)
Write-Host "Preparing npm dist..." -ForegroundColor Gray
$DistDir = Join-Path $ProjectRoot "dist"
if (-not (Test-Path $DistDir)) {
    New-Item -ItemType Directory -Path $DistDir | Out-Null
}
Copy-Item (Join-Path $SrcDir "web\webchugl-esm.js") (Join-Path $DistDir "webchugl-esm.js") -Force

Write-Host "`n=== Build Complete ===" -ForegroundColor Green
Write-Host "Output: $BuildDir" -ForegroundColor Gray
