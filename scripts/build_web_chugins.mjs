// Build all web-compatible ChuGins as .chug.wasm SIDE_MODULEs for WebChuGL
//
// Usage: node scripts/build_web_chugins.mjs /path/to/chugins
// Emsdk is auto-detected from the project directory, else emcc must be on PATH.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WIN = process.platform === 'win32';

const CHUGINS = {
    ABSaturator: ['ABSaturator.cpp', 'Filters.cpp'],
    AmbPan: ['AmbPan.cpp'],
    Binaural: ['Binaural.cpp'],
    Bitcrusher: ['Bitcrusher.cpp'],
    ConvRev: ['ConvRev.cpp', 'AudioFFT.cpp', 'FFTConvolver.cpp', 'Utilities.cpp', 'Timer.cpp'],
    Elliptic: ['Elliptic.cpp', 'setell.c', 'ellipse.c'],
    ExpDelay: ['ExpDelay.cpp'],
    ExpEnv: ['ExpEnv.cpp'],
    FIR: ['FIR.cpp'],
    FoldbackSaturator: ['FoldbackSaturator.cpp'],
    GVerb: ['gverbdsp.cpp', 'GVerb.cpp'],
    KasFilter: ['KasFilter.cpp'],
    Line: ['Line.cpp'],
    MagicSine: ['MagicSine.cpp'],
    Mesh2D: ['Stk.cpp', 'OnePole.cpp', 'Mesh2D-stk.cpp', 'Mesh2D.cpp'],
    MIAP: ['MIAP.cpp'],
    Multicomb: ['Odelay.cpp', 'Ocomb.cpp', 'Multicomb.cpp'],
    NHHall: ['NHHall.cpp'],
    Overdrive: ['Overdrive.cpp'],
    PanN: ['PanN.cpp'],
    Patch: ['Patch.cpp'],
    Perlin: ['Perlin.cpp', 'perlin-noise.cpp'],
    PitchTrack: ['PitchTrack.cpp', 'Helmholtz_dsp.cpp', 'fft_mayer.c'],
    PowerADSR: ['PowerADSR.cpp'],
    Random: ['Random.cpp'],
    Range: ['Range.cpp'],
    RegEx: ['RegEx.cpp'],
    Sigmund: ['Sigmund.cpp', 'd_fft_mayer.c', 'sigmund-dsp.c'],
    Spectacle: ['genlib/FFTReal.cpp', 'genlib/Obucket.cpp', 'genlib/Odelay.cpp', 'genlib/Offt.cpp',
        'genlib/Ooscil.cpp', 'genlib/RandGen.cpp', 'SpectacleBase.cpp', 'SpectEQ.cpp',
        'Spectacle-dsp.cpp', 'Spectacle.cpp'],
    Wavetable: ['Wavetable.cpp'],
    WinFuncEnv: ['WinFuncEnv.cpp'],
    WPDiodeLadder: ['WPDiodeLadder.cpp', 'VADiodeLadderFilter.cpp', 'VAOnePoleFilterEx.cpp'],
    WPKorg35: ['WPKorg35.cpp', 'VAOnePoleFilter.cpp', 'KorgThreeFiveLPF.cpp'],
    XML: ['tinyxml.cpp', 'tinyxmlerror.cpp', 'tinyxmlparser.cpp', 'util_xml.cpp', 'XML.cpp'],
};

const FLAGS = ['-O3', '-sSIDE_MODULE=1', '-pthread', '-sDISABLE_EXCEPTION_CATCHING=0', '-fPIC'];

const chuginsDir = process.argv[2];
if (!chuginsDir) fail('Usage: node scripts/build_web_chugins.mjs /path/to/chugins');
if (!existsSync(join(chuginsDir, 'chuck/include/chugin.h'))) {
    fail('chugin.h not found under ' + chuginsDir + '. Point at the chugins repo root.');
}

const outDir = join(ROOT, 'web', 'chugins');
mkdirSync(outDir, { recursive: true });

const emsdk = readdirSync(ROOT)
    .filter((d) => d.startsWith('emsdk-'))
    .sort()
    .map((d) => join(ROOT, d, 'install', 'emscripten', 'emcc.py'))
    .filter(existsSync)
    .pop();
if (!emsdk && spawnSync(WIN ? 'where' : 'which', ['emcc']).status !== 0) {
    fail('No emsdk in the project and no emcc on PATH.');
}

function fail(msg) {
    console.error('Error: ' + msg);
    process.exit(1);
}

console.log('Building web ChuGins...');
console.log('  Source: ' + chuginsDir);
console.log('  Output: ' + outDir);
console.log('  Emcc:   ' + (emsdk || 'emcc (PATH)'));
console.log('');

const failed = [];
let passed = 0;

for (const [name, sources] of Object.entries(CHUGINS)) {
    process.stdout.write('  Building ' + name + '... ');
    const args = [...FLAGS, '-I', join(chuginsDir, 'chuck/include/'),
        ...sources, '-o', join(outDir, name + '.chug.wasm')];
    const r = emsdk
        ? spawnSync('py', [emsdk, ...args],
            { cwd: join(chuginsDir, name), encoding: 'utf8',
              env: { ...process.env, EMSDK_PYTHON: '' } })
        : spawnSync('emcc', args, { cwd: join(chuginsDir, name), encoding: 'utf8' });

    if (r.status === 0) {
        console.log('OK');
        passed++;
    } else {
        console.log('FAILED');
        for (const line of String(r.stderr || '').trimEnd().split('\n')) console.log('    ' + line);
        failed.push(name);
    }
}

console.log('\nDone: ' + passed + ' passed, ' + failed.length + ' failed');
if (failed.length) {
    console.log('Failed: ' + failed.join(', '));
    process.exit(1);
}
