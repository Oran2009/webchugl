#!/bin/bash
# Build all web-compatible ChuGins as .chug.wasm SIDE_MODULEs for WebChuGL
#
# Usage: ./build_web_chugins.sh /path/to/chugins
# Requires: emcc on PATH (activate emsdk first)

set -e

CHUGINS_DIR="${1:?Usage: $0 /path/to/chugins}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_DIR="$PROJECT_ROOT/web/chugins"

# Verify chugins repo
if [ ! -f "$CHUGINS_DIR/chuck/include/chugin.h" ]; then
    echo "ERROR: chugin.h not found at $CHUGINS_DIR/chuck/include/chugin.h"
    echo "Make sure you point to the chugins repo root."
    exit 1
fi

# Verify emcc
if ! command -v emcc &>/dev/null; then
    echo "ERROR: emcc not found. Activate emsdk first."
    exit 1
fi

mkdir -p "$OUTPUT_DIR"

EMCC_FLAGS=(-O3 -sSIDE_MODULE=1 -pthread -sDISABLE_EXCEPTION_CATCHING=0 -fPIC)
INCLUDE=(-I "$CHUGINS_DIR/chuck/include/")

PASS=0
FAIL=0
FAILED_LIST=""

build_chugin() {
    local name="$1"
    shift
    local sources=("$@")

    echo -n "  Building $name... "
    if (cd "$CHUGINS_DIR/$name" && emcc "${EMCC_FLAGS[@]}" "${INCLUDE[@]}" "${sources[@]}" -o "$OUTPUT_DIR/$name.chug.wasm" 2>/dev/null); then
        echo "OK"
        PASS=$((PASS + 1))
    else
        echo "FAILED"
        FAIL=$((FAIL + 1))
        FAILED_LIST="$FAILED_LIST $name"
    fi
}

echo "Building web ChuGins..."
echo "  Source: $CHUGINS_DIR"
echo "  Output: $OUTPUT_DIR"
echo ""

build_chugin ABSaturator        ABSaturator.cpp Filters.cpp
build_chugin AmbPan             AmbPan.cpp
build_chugin Binaural           Binaural.cpp
build_chugin Bitcrusher         Bitcrusher.cpp
build_chugin ConvRev            ConvRev.cpp AudioFFT.cpp FFTConvolver.cpp Utilities.cpp Timer.cpp
build_chugin Elliptic           Elliptic.cpp setell.c ellipse.c
build_chugin ExpDelay           ExpDelay.cpp
build_chugin ExpEnv             ExpEnv.cpp
build_chugin FIR                FIR.cpp
build_chugin FoldbackSaturator  FoldbackSaturator.cpp
build_chugin GVerb              gverbdsp.cpp GVerb.cpp
build_chugin KasFilter          KasFilter.cpp
build_chugin Line               Line.cpp
build_chugin MagicSine          MagicSine.cpp
build_chugin Mesh2D             Stk.cpp OnePole.cpp Mesh2D-stk.cpp Mesh2D.cpp
build_chugin MIAP               MIAP.cpp
build_chugin Multicomb          Odelay.cpp Ocomb.cpp Multicomb.cpp
build_chugin NHHall             NHHall.cpp
build_chugin Overdrive          Overdrive.cpp
build_chugin PanN               PanN.cpp
build_chugin Patch              Patch.cpp
build_chugin Perlin             Perlin.cpp perlin-noise.cpp
build_chugin PitchTrack         PitchTrack.cpp Helmholtz_dsp.cpp fft_mayer.c
build_chugin PowerADSR          PowerADSR.cpp
build_chugin Random             Random.cpp
build_chugin Range              Range.cpp
build_chugin RegEx              RegEx.cpp
build_chugin Sigmund            Sigmund.cpp d_fft_mayer.c sigmund-dsp.c
build_chugin Spectacle          genlib/FFTReal.cpp genlib/Obucket.cpp genlib/Odelay.cpp genlib/Offt.cpp genlib/Ooscil.cpp genlib/RandGen.cpp SpectacleBase.cpp SpectEQ.cpp Spectacle-dsp.cpp Spectacle.cpp
build_chugin Wavetable          Wavetable.cpp
build_chugin WinFuncEnv         WinFuncEnv.cpp
build_chugin WPDiodeLadder      WPDiodeLadder.cpp VADiodeLadderFilter.cpp VAOnePoleFilterEx.cpp
build_chugin WPKorg35           WPKorg35.cpp VAOnePoleFilter.cpp KorgThreeFiveLPF.cpp
build_chugin XML                tinyxml.cpp tinyxmlerror.cpp tinyxmlparser.cpp util_xml.cpp XML.cpp

echo ""
echo "Done: $PASS passed, $FAIL failed"
if [ $FAIL -gt 0 ]; then
    echo "Failed:$FAILED_LIST"
    exit 1
fi
