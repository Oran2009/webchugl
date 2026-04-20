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
# Windows invokes the .py entry points directly via `py` rather than using
# the .bat wrappers: the wrappers consult EMSDK_PYTHON which may point at a
# stale or missing interpreter in CI/clean-clone environments. build.sh uses
# the plain `emcmake`/`emmake` shell wrappers (Unix has no equivalent issue).
$EmCMake = Join-Path $EmsdkDir "emcmake.py"
$EmMake = Join-Path $EmsdkDir "emmake.py"

Write-Host "=== Building WebChuGL ===" -ForegroundColor Cyan

# Compile TypeScript
Write-Host "Compiling TypeScript..." -ForegroundColor Yellow
Push-Location $ProjectRoot
npx tsc
if ($LASTEXITCODE -ne 0) { throw "TypeScript compilation failed" }
npx tsc -p tsconfig.esm-declarations.json
if ($LASTEXITCODE -ne 0) { throw "ESM declaration generation failed" }
npx esbuild src/web/webchugl.ts --bundle --format=iife --outfile=src/web/webchugl.js --sourcemap
if ($LASTEXITCODE -ne 0) { throw "esbuild bundling failed" }
Pop-Location

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

# Copy runtime to dist/ (for npm publishing — includes all assets)
Write-Host "Preparing npm dist..." -ForegroundColor Gray
$DistDir = Join-Path $ProjectRoot "dist"
if (-not (Test-Path $DistDir)) {
    New-Item -ItemType Directory -Path $DistDir | Out-Null
}
foreach ($f in @("index.js", "webchugl.wasm", "webchugl.js",
                 "audio-worklet-processor.js", "jszip.min.js")) {
    $src = Join-Path $BuildWebchuglDir $f
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $DistDir $f) -Force
    }
}
Copy-Item (Join-Path $SrcDir "web\webchugl-esm.js") (Join-Path $DistDir "webchugl-esm.js") -Force
# Copy TypeScript declaration files for npm consumers
$DtsPath = Join-Path $SrcDir "web\webchugl-esm.d.ts"
if (Test-Path $DtsPath) {
    Copy-Item $DtsPath (Join-Path $DistDir "webchugl-esm.d.ts") -Force
}
$ChuckDtsPath = Join-Path $SrcDir "web\types\chuck.d.ts"
if (Test-Path $ChuckDtsPath) {
    $DistTypesDir = Join-Path $DistDir "types"
    if (-not (Test-Path $DistTypesDir)) {
        New-Item -ItemType Directory -Path $DistTypesDir | Out-Null
    }
    Copy-Item $ChuckDtsPath (Join-Path $DistTypesDir "chuck.d.ts") -Force
}

# Inject package version into ESM (replaces __WEBCHUGL_VERSION__ placeholder)
$PkgVersion = (Get-Content (Join-Path $ProjectRoot "package.json") | ConvertFrom-Json).version
$EsmPath = Join-Path $DistDir "webchugl-esm.js"
(Get-Content $EsmPath -Raw).Replace('__WEBCHUGL_VERSION__', $PkgVersion) | Set-Content $EsmPath -NoNewline
Write-Host "Injected version $PkgVersion into webchugl-esm.js" -ForegroundColor Gray

Write-Host "`n=== Build Complete ===" -ForegroundColor Green
Write-Host "Output: $BuildDir" -ForegroundColor Gray
