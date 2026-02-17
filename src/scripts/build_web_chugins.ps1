# Build all web-compatible ChuGins as .chug.wasm SIDE_MODULEs for WebChuGL
#
# Usage: .\build_web_chugins.ps1 -ChuginsDir C:\path\to\chugins
# Emsdk is auto-detected from the project directory

param(
    [Parameter(Mandatory=$true)]
    [string]$ChuginsDir
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SrcDir = Split-Path -Parent $ScriptDir
$ProjectRoot = Split-Path -Parent $SrcDir
$OutputDir = Join-Path $ProjectRoot "chugins"
$EmsdkDir = Join-Path $ProjectRoot "emsdk-4.0.17\install\emscripten"
$Emcc = Join-Path $EmsdkDir "emcc.py"

# Verify emsdk
if (-not (Test-Path $Emcc)) {
    Write-Error "emcc.py not found at $Emcc. Run setup.ps1 first."
    exit 1
}

# Verify chugins repo
$ChuginHeader = Join-Path $ChuginsDir "chuck\include\chugin.h"
if (-not (Test-Path $ChuginHeader)) {
    Write-Error "chugin.h not found at $ChuginHeader. Make sure you point to the chugins repo root."
    exit 1
}

if (-not (Test-Path $OutputDir)) { New-Item -ItemType Directory -Path $OutputDir | Out-Null }

$IncludeDir = Join-Path $ChuginsDir "chuck/include/"

$Pass = 0
$Fail = 0
$FailedList = @()

function Build-Chugin {
    param([string]$Name, [string[]]$Sources)

    Write-Host "  Building $Name... " -NoNewline
    $srcDir = Join-Path $ChuginsDir $Name
    $outFile = Join-Path $OutputDir "$Name.chug.wasm"

    $args = @("-O3", "-sSIDE_MODULE=1", "-pthread", "-sDISABLE_EXCEPTION_CATCHING=0", "-fPIC",
              "-I", $IncludeDir) + $Sources + @("-o", $outFile)

    Push-Location $srcDir
    try {
        $env:EMSDK_PYTHON = ""
        $ErrorActionPreference = "Continue"
        $output = py $Emcc @args 2>&1
        $ErrorActionPreference = "Stop"
        if ($LASTEXITCODE -eq 0) {
            Write-Host "OK" -ForegroundColor Green
            $script:Pass++
        } else {
            Write-Host "FAILED" -ForegroundColor Red
            $output | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkRed }
            $script:Fail++
            $script:FailedList += $Name
        }
    } finally {
        Pop-Location
    }
}

Write-Host "Building web ChuGins..."
Write-Host "  Source: $ChuginsDir"
Write-Host "  Output: $OutputDir"
Write-Host "  Emcc:   $Emcc"
Write-Host ""

Build-Chugin ABSaturator        ABSaturator.cpp, Filters.cpp
Build-Chugin AmbPan             AmbPan.cpp
Build-Chugin Binaural           Binaural.cpp
Build-Chugin Bitcrusher         Bitcrusher.cpp
Build-Chugin ConvRev            ConvRev.cpp, AudioFFT.cpp, FFTConvolver.cpp, Utilities.cpp, Timer.cpp
Build-Chugin Elliptic           Elliptic.cpp, setell.c, ellipse.c
Build-Chugin ExpDelay           ExpDelay.cpp
Build-Chugin ExpEnv             ExpEnv.cpp
Build-Chugin FIR                FIR.cpp
Build-Chugin FoldbackSaturator  FoldbackSaturator.cpp
Build-Chugin GVerb              gverbdsp.cpp, GVerb.cpp
Build-Chugin KasFilter          KasFilter.cpp
Build-Chugin Line               Line.cpp
Build-Chugin MagicSine          MagicSine.cpp
Build-Chugin Mesh2D             Stk.cpp, OnePole.cpp, Mesh2D-stk.cpp, Mesh2D.cpp
Build-Chugin MIAP               MIAP.cpp
Build-Chugin Multicomb          Odelay.cpp, Ocomb.cpp, Multicomb.cpp
Build-Chugin NHHall             NHHall.cpp
Build-Chugin Overdrive          Overdrive.cpp
Build-Chugin PanN               PanN.cpp
Build-Chugin Patch              Patch.cpp
Build-Chugin Perlin             Perlin.cpp, perlin-noise.cpp
Build-Chugin PitchTrack         PitchTrack.cpp, Helmholtz_dsp.cpp, fft_mayer.c
Build-Chugin PowerADSR          PowerADSR.cpp
Build-Chugin Random             Random.cpp
Build-Chugin Range              Range.cpp
Build-Chugin RegEx              RegEx.cpp
Build-Chugin Sigmund            Sigmund.cpp, d_fft_mayer.c, sigmund-dsp.c
Build-Chugin Spectacle          genlib/FFTReal.cpp, genlib/Obucket.cpp, genlib/Odelay.cpp, genlib/Offt.cpp, genlib/Ooscil.cpp, genlib/RandGen.cpp, SpectacleBase.cpp, SpectEQ.cpp, Spectacle-dsp.cpp, Spectacle.cpp
Build-Chugin Wavetable          Wavetable.cpp
Build-Chugin WinFuncEnv         WinFuncEnv.cpp
Build-Chugin WPDiodeLadder      WPDiodeLadder.cpp, VADiodeLadderFilter.cpp, VAOnePoleFilterEx.cpp
Build-Chugin WPKorg35           WPKorg35.cpp, VAOnePoleFilter.cpp, KorgThreeFiveLPF.cpp
Build-Chugin XML                tinyxml.cpp, tinyxmlerror.cpp, tinyxmlparser.cpp, util_xml.cpp, XML.cpp

Write-Host ""
Write-Host "Done: $Pass passed, $Fail failed"
if ($Fail -gt 0) {
    Write-Host "Failed: $($FailedList -join ', ')" -ForegroundColor Red
    exit 1
}
