// Build WebChuGL (WASM compilation)
// Usage: node scripts/build.mjs [--clean] [-j N]

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, 'src');
const BUILD = join(SRC, 'build');
const CMAKE_BUILD = join(SRC, '.cmake-build');
const WEB_OUT = join(BUILD, 'webchugl');
const DIST = join(ROOT, 'dist');
const WIN = process.platform === 'win32';

const argv = process.argv.slice(2);
const clean = argv.includes('--clean') || argv.includes('-c');
const jobs = argv.includes('-j') ? argv[argv.indexOf('-j') + 1] : '8';

const emsdk = readdirSync(ROOT)
    .filter((d) => d.startsWith('emsdk-'))
    .sort()
    .map((d) => join(ROOT, d, 'install', 'emscripten'))
    .filter(existsSync)
    .pop();
if (!emsdk) fail('Emscripten SDK not found. Run setup first.');

function fail(msg) {
    console.error('Error: ' + msg);
    process.exit(1);
}

function run(cmd, args, cwd = ROOT, env = process.env) {
    const r = spawnSync(cmd, args, { cwd, env, stdio: 'inherit' });
    if (r.status !== 0) fail([cmd, ...args].join(' ') + ' failed');
}

// node_modules/.bin shims are .cmd on Windows, which spawn rejects; run the
// package entry points with this same node instead.
function npx(pkgBin, args) {
    run(process.execPath, [join(ROOT, 'node_modules', pkgBin), ...args]);
}

// Windows runs the .py entry points through `py`: the .bat wrappers consult
// EMSDK_PYTHON, which can point at a stale interpreter in a clean clone.
function emrun(tool, args, cwd) {
    const env = { ...process.env, EMSDK_PYTHON: '' };
    if (WIN) run('py', [join(emsdk, tool + '.py'), ...args], cwd, env);
    else run(join(emsdk, tool), args, cwd, env);
}

function copy(from, to, optional = false) {
    if (!existsSync(from)) {
        if (optional) return;
        fail('missing ' + from);
    }
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
}

const ninja = spawnSync(WIN ? 'where' : 'which', ['ninja']).status === 0;
if (!ninja && spawnSync(WIN ? 'where' : 'which', ['make']).status !== 0) {
    fail('Neither ninja nor make found on PATH. Install one and retry.');
}

console.log('=== Building WebChuGL ===');

console.log('Compiling TypeScript...');
npx('typescript/bin/tsc', []);
npx('typescript/bin/tsc', ['-p', 'tsconfig.esm-declarations.json']);
npx('esbuild/bin/esbuild', ['src/runtime/webchugl.ts', '--bundle', '--format=esm',
    '--outfile=src/runtime/webchugl.js', '--sourcemap']);

if (clean) {
    for (const d of [BUILD, CMAKE_BUILD]) {
        if (existsSync(d)) { console.log('Cleaning ' + d + '...'); rmSync(d, { recursive: true, force: true }); }
    }
}
for (const d of [BUILD, CMAKE_BUILD, WEB_OUT, DIST]) mkdirSync(d, { recursive: true });

if (!existsSync(join(CMAKE_BUILD, 'CMakeCache.txt'))) {
    console.log('Configuring with CMake...');
    const args = ['cmake'];
    if (ninja) args.push('-G', 'Ninja');
    args.push(SRC, '-DCMAKE_POLICY_VERSION_MINIMUM=3.5', '-DCMAKE_BUILD_TYPE=Release');
    emrun('emcmake', args, CMAKE_BUILD);
}

console.log('Building WASM...');
emrun('emmake', [ninja ? 'ninja' : 'make', '-j', jobs], CMAKE_BUILD);

console.log('Copying web outputs...');
for (const f of ['index.js', 'webchugl.wasm']) {
    copy(join(CMAKE_BUILD, 'webchugl', f), join(WEB_OUT, f), true);
}
copy(join(CMAKE_BUILD, 'index.html'), join(BUILD, 'index.html'), true);
copy(join(SRC, 'runtime/assets/sw.js'), join(BUILD, 'sw.js'));
// The site needs its own copy at the root to be cross-origin isolated.
copy(join(SRC, 'runtime/assets/sw.js'), join(ROOT, 'site', 'sw.js'));
copy(join(SRC, 'runtime/assets/manifest.json'), join(BUILD, 'manifest.json'));

// Always from source so TS-only changes propagate without a WASM relink.
copy(join(SRC, 'runtime/webchugl.js'), join(WEB_OUT, 'webchugl.js'));
copy(join(SRC, 'runtime/webchugl.js.map'), join(WEB_OUT, 'webchugl.js.map'), true);
copy(join(SRC, 'runtime/webchugl-esm.js'), join(WEB_OUT, 'webchugl-esm.js'));
copy(join(SRC, 'runtime/assets/audio-worklet-processor.js'), join(WEB_OUT, 'audio-worklet-processor.js'));
for (const f of ['chugl_logo_light.png', 'chugl_logo_dark.png']) {
    copy(join(SRC, 'runtime/assets', f), join(WEB_OUT, f));
}

for (const f of ['index.js', 'webchugl.wasm']) {
    if (!existsSync(join(WEB_OUT, f))) fail('build output missing: webchugl/' + f + ' in ' + BUILD);
}

console.log('Preparing npm dist...');
for (const f of ['index.js', 'webchugl.wasm', 'webchugl.js', 'audio-worklet-processor.js']) {
    copy(join(WEB_OUT, f), join(DIST, f), true);
}
copy(join(SRC, 'runtime/webchugl-esm.js'), join(DIST, 'webchugl-esm.js'));
// sw.js on the CDN lets users write a one-line sw.js instead of downloading one
copy(join(SRC, 'runtime/assets/sw.js'), join(DIST, 'sw.js'));
copy(join(SRC, 'runtime/webchugl-esm.d.ts'), join(DIST, 'webchugl-esm.d.ts'), true);
copy(join(SRC, 'runtime/types/chuck.d.ts'), join(DIST, 'types/chuck.d.ts'), true);

const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const esm = join(DIST, 'webchugl-esm.js');
writeFileSync(esm, readFileSync(esm, 'utf8').replaceAll('__WEBCHUGL_VERSION__', version));
console.log('Injected version ' + version + ' into webchugl-esm.js');

console.log('\n=== Build Complete ===');
console.log('Output: ' + BUILD);
