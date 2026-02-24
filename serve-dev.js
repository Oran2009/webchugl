#!/usr/bin/env node
// Dev server that rewrites CDN imports to local /dist/ files.
// Examples stay unchanged — they import from the jsdelivr CDN URL,
// and this server intercepts those requests and serves local files.
//
// Usage: node serve-dev.js [port]
// Then open: http://localhost:8080/web/examples/drum-machine/

import { createServer } from 'http';
import { readFile, stat } from 'fs/promises';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const PORT = parseInt(process.argv[2] || '8080', 10);
const ROOT = fileURLToPath(new URL('.', import.meta.url));

const MIME = {
    '.html': 'text/html',
    '.js':   'application/javascript',
    '.mjs':  'application/javascript',
    '.css':  'text/css',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
    '.wav':  'audio/wav',
    '.mp3':  'audio/mpeg',
    '.ck':   'text/plain',
    '.zip':  'application/zip',
};

// CDN URL pattern that examples use for the ESM import
const CDN_ESM = '/npm/webchugl/+esm';
const CDN_VERSIONED = /^\/npm\/webchugl@[^/]+\/dist\//;

// Rewrite CDN URLs to local /dist/ paths in file content
function rewriteCdnUrls(content) {
    content = content.replace(
        /https:\/\/cdn\.jsdelivr\.net\/npm\/webchugl\/\+esm/g,
        '/dist/webchugl-esm.js'
    );
    content = content.replace(
        /https:\/\/cdn\.jsdelivr\.net\/npm\/webchugl@[^'"]+\/dist\//g,
        '/dist/'
    );
    return content;
}

function needsRewrite(filePath, pathname) {
    const ext = extname(filePath);
    return (ext === '.js' && (pathname.startsWith('/web/examples/') || pathname === '/dist/webchugl-esm.js'))
        || (ext === '.html' && pathname.startsWith('/web/'));
}

async function serveWithRewrite(filePath, res) {
    try {
        const ext = extname(filePath);
        let content = await readFile(filePath, 'utf-8');
        content = rewriteCdnUrls(content);
        setCOIHeaders(res);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(content);
    } catch {
        res.writeHead(404);
        res.end('Not found');
    }
}

async function serveFile(filePath, res) {
    try {
        const ext = extname(filePath);
        const content = await readFile(filePath);
        setCOIHeaders(res);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(content);
    } catch {
        res.writeHead(404);
        res.end('Not found');
    }
}

function setCOIHeaders(res) {
    // Required for SharedArrayBuffer (audio ring buffers)
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    // Allow CDN resources (mediapipe, rapier, highlight.js, etc.)
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
}

const server = createServer(async (req, res) => {
    let url = new URL(req.url, `http://localhost:${PORT}`);
    let pathname = decodeURIComponent(url.pathname);

    // --- CDN rewrites ---

    // Rewrite jsdelivr CDN host requests (shouldn't happen with same-origin,
    // but handle the ESM +esm redirect pattern)
    if (pathname === CDN_ESM || pathname === '/npm/webchugl/+esm') {
        // Serve local ESM entry point
        pathname = '/dist/webchugl-esm.js';
    } else if (CDN_VERSIONED.test(pathname)) {
        // Rewrite /npm/webchugl@x.y.z/dist/foo -> /dist/foo
        pathname = pathname.replace(CDN_VERSIONED, '/dist/');
    }

    // --- Rewrite JS/HTML files to intercept CDN imports ---
    const filePath = join(ROOT, pathname);

    if (needsRewrite(filePath, pathname)) {
        return serveWithRewrite(filePath, res);
    }

    // --- Serve static files ---
    try {
        const s = await stat(filePath);
        if (s.isDirectory()) {
            // Redirect /dir to /dir/ so relative paths resolve correctly
            if (!pathname.endsWith('/')) {
                res.writeHead(301, { Location: pathname + '/' });
                res.end();
                return;
            }
            // Try index.html — rewrite if under /web/
            const indexPath = join(filePath, 'index.html');
            if (pathname.startsWith('/web/')) {
                return serveWithRewrite(indexPath, res);
            }
            return serveFile(indexPath, res);
        }
        return serveFile(filePath, res);
    } catch {
        res.writeHead(404);
        res.end('Not found');
    }
});

server.listen(PORT, () => {
    console.log(`WebChuGL dev server: http://localhost:${PORT}`);
    console.log(`Examples:            http://localhost:${PORT}/web/examples/`);
    console.log(`\nCDN imports are rewritten to local /dist/ files.`);
    console.log('Press Ctrl+C to stop.\n');
});
