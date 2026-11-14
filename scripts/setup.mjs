// WebChuGL setup: clones pinned dependencies and installs the Emscripten SDK.
//
// Usage: node scripts/setup.mjs

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WIN = process.platform === 'win32';

const CHUGL_REPO = 'https://github.com/Oran2009/chugl.git';
const CHUGL_COMMIT = 'be6e609dcffcdff83b356a0c8100b8b71a8f6e63';

const CHUCK_REPO = 'https://github.com/ccrma/chuck.git';
const CHUCK_TAG = 'chuck-1.5.5.8';

const EMSDK_VERSION = '5.0.3';
// Pin emsdk orchestration scripts to a known commit for reproducibility
const EMSDK_COMMIT = '41190c21c662e9cc1962aea94e71cbae9fd2fc87';

function fail(msg) {
    console.error(msg);
    process.exit(1);
}

function run(cmd, args, cwd = ROOT, env = process.env) {
    const r = spawnSync(cmd, args, { cwd, env, stdio: 'inherit' });
    if (r.status !== 0) fail([cmd, ...args].join(' ') + ' failed');
}

function capture(cmd, args, cwd = ROOT, env = process.env) {
    const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
    return { ok: r.status === 0, out: ((r.stdout || '') + (r.stderr || '')).trim() };
}

// Clone at `ref`, or report when an existing checkout has drifted off it.
function cloneOrCheck(tag, dir, repo, ref, resolve) {
    if (existsSync(dir)) {
        console.log(`[${tag}] Directory exists, checking revision...`);
        const expected = resolve ? resolve(dir) : ref;
        if (!expected) {
            console.log(`[${tag}] '${ref}' not found locally; run: git fetch --tags`);
            return;
        }
        const head = capture('git', ['rev-parse', 'HEAD'], dir).out;
        if (head === expected) console.log(`[${tag}] Already at pinned ${ref}`);
        else {
            console.log(`[${tag}] Warning: HEAD (${head}) differs from ${ref} (${expected})`);
            console.log(`[${tag}] You may need: git fetch --tags && git checkout ${ref}`);
        }
        return;
    }
    console.log(`[${tag}] Cloning from ${repo}...`);
    run('git', ['clone', '--filter=blob:none', repo, dir]);
    run('git', ['checkout', ref], dir);
    console.log(`[${tag}] Cloned and checked out ${ref}`);
}

function assertEmsdkVersion(installDir) {
    // Windows has no em++ shim on PATH; run the .py entry point through `py`,
    // with EMSDK_PYTHON cleared so a stale interpreter path can't break it.
    const env = { ...process.env, EMSDK_PYTHON: '' };
    const probe = WIN
        ? capture('py', [join(installDir, 'em++.py'), '--version'], ROOT, env)
        : capture(join(installDir, 'em++'), ['--version'], ROOT, env);

    if (!probe.ok) fail(`[emsdk] ERROR: em++ --version failed: ${probe.out}`);
    const line = probe.out.split('\n').find((l) => l.includes(EMSDK_VERSION));
    if (!line) fail(`[emsdk] ERROR: Version mismatch. Expected ${EMSDK_VERSION}, got: ${probe.out}`);
    console.log('[emsdk] Verified: ' + line.trim());
}

console.log('=== WebChuGL Setup ===\n');

cloneOrCheck('chugl', join(ROOT, 'chugl'), CHUGL_REPO, CHUGL_COMMIT);

cloneOrCheck('chuck', join(ROOT, 'chuck'), CHUCK_REPO, CHUCK_TAG, (dir) => {
    // ^{} dereferences an annotated tag to the commit it points at.
    const r = capture('git', ['rev-parse', '-q', '--verify', `${CHUCK_TAG}^{}`], dir);
    return r.ok ? r.out : null;
});

const emsdkDir = join(ROOT, `emsdk-${EMSDK_VERSION}`);
const emsdkInstall = join(emsdkDir, 'install', 'emscripten');

if (existsSync(emsdkInstall)) {
    console.log(`[emsdk] Emscripten ${EMSDK_VERSION} already installed`);
} else {
    console.log(`\n=== Installing Emscripten SDK ${EMSDK_VERSION} ===`);
    if (!existsSync(emsdkDir)) {
        console.log('[emsdk] Cloning emsdk...');
        run('git', ['clone', '--filter=blob:none',
            'https://github.com/emscripten-core/emsdk.git', emsdkDir]);
        run('git', ['checkout', EMSDK_COMMIT], emsdkDir);
    }

    const emsdk = WIN ? join(emsdkDir, 'emsdk.bat') : join(emsdkDir, 'emsdk');
    console.log(`[emsdk] Installing version ${EMSDK_VERSION}...`);
    run(emsdk, ['install', EMSDK_VERSION], emsdkDir);
    console.log(`[emsdk] Activating version ${EMSDK_VERSION}...`);
    run(emsdk, ['activate', EMSDK_VERSION], emsdkDir);

    // install/ keeps the toolchain in one place the build can glob for.
    mkdirSync(join(emsdkDir, 'install'), { recursive: true });
    const upstream = join(emsdkDir, 'upstream', 'emscripten');
    if (existsSync(upstream)) {
        renameSync(upstream, emsdkInstall);
        console.log('[emsdk] Moved emscripten to install/');
    }
    console.log(`[emsdk] Emscripten ${EMSDK_VERSION} installed successfully`);
}

assertEmsdkVersion(emsdkInstall);

console.log('\n=== Setup Complete ===\n');
console.log('Next steps:');
console.log('  node scripts/build.mjs\n');
