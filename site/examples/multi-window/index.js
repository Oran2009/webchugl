import ChuGL from 'https://cdn.jsdelivr.net/npm/webchugl/+esm';

// ── Init two independent ChuGL instances ────────────────────

var ck1 = await ChuGL.init({ canvas: document.getElementById('canvas-1') });
var ck2 = await ChuGL.init({ canvas: document.getElementById('canvas-2') });

await ck1.runFile('./sphere.ck');
await ck2.runFile('./cubes.ck');

// ── Canvas-specific interaction + cross-window echo ─────────

var canvas1 = document.getElementById('canvas-1');
var canvas2 = document.getElementById('canvas-2');

// Canvas 1: click Y position → play sphere note + echo to cubes
function onCanvas1(e) {
    var rect = canvas1.getBoundingClientRect();
    var y = 1 - (e.clientY - rect.top) / rect.height;
    var idx = Math.max(0, Math.min(6, Math.floor(y * 7)));
    ck1.setInt('noteIndex', idx);
    ck1.signalEvent('noteOn');
    ck2.signalEvent('echo');
}
canvas1.addEventListener('mousedown', onCanvas1);
canvas1.addEventListener('touchstart', function(e) {
    e.preventDefault();
    onCanvas1(e.touches[0]);
});

// Canvas 2: click X position → play cube note + echo to sphere
function onCanvas2(e) {
    var rect = canvas2.getBoundingClientRect();
    var x = (e.clientX - rect.left) / rect.width;
    // Convert screen X to world X using camera params (FOV 45°, distance 4)
    var aspect = rect.width / rect.height;
    var halfWidth = Math.tan(Math.PI / 8) * 4 * aspect; // tan(22.5°) * 4 * aspect
    var worldX = (x - 0.5) * 2 * halfWidth;
    // Cubes at worldX = (i-3) * 0.55; find nearest
    var idx = Math.max(0, Math.min(6, Math.round(worldX / 0.55) + 3));
    ck2.setInt('noteIndex', idx);
    ck2.signalEvent('noteOn');
    ck1.signalEvent('echo');
}
canvas2.addEventListener('mousedown', onCanvas2);
canvas2.addEventListener('touchstart', function(e) {
    e.preventDefault();
    onCanvas2(e.touches[0]);
});
