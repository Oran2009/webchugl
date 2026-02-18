import ChuGL from '../webchugl/webchugl-esm.js';

var ck = await ChuGL.init({
    canvas: document.getElementById('canvas'),
    whereIsChuGL: '../webchugl/',
    onProgress: function(pct) {
        var el = document.getElementById('progress-fill');
        if (el) el.style.width = Math.round(pct) + '%';
    },
    onError: function(msg) {
        console.error('[WebChuGL] ' + msg);
        var pb = document.getElementById('progress-bar');
        if (pb) pb.style.display = 'none';
        var errEl = document.getElementById('error-text');
        if (errEl) {
            errEl.textContent = msg;
            errEl.style.display = 'block';
        }
    },
});

await ck.loadChugin('../chugins/Bitcrusher.chug.wasm');
await ck.runZip('./code.zip');

var ls = document.getElementById('loading-screen');
if (ls) ls.classList.add('hidden');
document.getElementById('canvas').focus();