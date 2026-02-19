import ChuGL from '../../src/webchugl-esm.js';

var logEl = document.getElementById('log');
function log(msg, cls) {
    var d = document.createElement('div');
    d.className = cls || 'log-info';
    d.textContent = msg;
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
}

log('Initializing WebChuGL...');
var ck = await ChuGL.init({
    canvas: document.getElementById('canvas'),
    whereIsChuGL: '../../src/',
});
log('WebChuGL ready.', 'log-ok');

// Start a minimal render loop
ck.runCode('while(true) GG.nextFrame() => now;');

// ── Test snippets for each chugin ────────────────────────────

var testSnippets = {
    'Bitcrusher':        'SinOsc s => Bitcrusher b => dac; 4 => b.bits; 3::second => now;',
    'NHHall':            'Noise n => NHHall r => dac; 0.02 => n.gain; 3::second => now;',
    'Overdrive':         'SinOsc s => Overdrive d => dac; 0.8 => d.drive; 3::second => now;',
    'WPDiodeLadder':     'Noise n => WPDiodeLadder f => dac; 800 => f.cutoff; 3::second => now;',
    'GVerb':             'Noise n => GVerb r => dac; 0.02 => n.gain; 3::second => now;',
    'FoldbackSaturator': 'SinOsc s => FoldbackSaturator f => dac; 0.8 => f.index; 3::second => now;',
};

var lastLoaded = null;

// ── Load from URL ────────────────────────────────────────────

var select = document.getElementById('chugin-select');
var btnLoad = document.getElementById('btn-load-url');
var btnTest = document.getElementById('btn-test');

btnLoad.addEventListener('click', async function() {
    var url = select.value;
    var name = select.options[select.selectedIndex].text;
    btnLoad.disabled = true;
    log('Fetching ' + name + ' from URL...');
    try {
        await ck.loadChugin(url);
        lastLoaded = name;
        log('Loaded: ' + name, 'log-ok');
        btnTest.disabled = false;
    } catch (e) {
        log('Error: ' + e.message, 'log-err');
    }
    btnLoad.disabled = false;
});

btnTest.addEventListener('click', function() {
    if (!lastLoaded || !testSnippets[lastLoaded]) {
        log('No test snippet for: ' + lastLoaded, 'log-err');
        return;
    }
    log('Running: ' + lastLoaded + ' test...');
    ck.runCode(testSnippets[lastLoaded]);
    log('Playing for 3 seconds...', 'log-ok');
});

// ── Load ChuMP Package ───────────────────────────────────────

var btnPkg = document.getElementById('btn-load-pkg');
var pkgInput = document.getElementById('pkg-name');

btnPkg.addEventListener('click', async function() {
    var name = pkgInput.value.trim();
    if (!name) return;
    btnPkg.disabled = true;
    log('Loading package: ' + name + '...');
    try {
        await ck.loadPackage(name);
        log('Package loaded: ' + name, 'log-ok');
        log('You can now use: @import ' + name, 'log-ok');
    } catch (e) {
        log('Error: ' + e.message, 'log-err');
    }
    btnPkg.disabled = false;
});
