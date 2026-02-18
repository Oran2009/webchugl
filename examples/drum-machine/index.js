import ChuGL from '../webchugl/webchugl-esm.js';

var ck = await ChuGL.init({
    canvas: document.getElementById('canvas'),
    whereIsChuGL: '../webchugl/',
});

await ck.runFile('./main.ck');

// ── Constants ───────────────────────────────────────────────

var NUM_STEPS = 16;
var INSTRUMENTS = ['kick', 'snare', 'hihat', 'clap'];
var patterns = {};
INSTRUMENTS.forEach(function(name) {
    patterns[name] = new Array(NUM_STEPS).fill(0);
});

// ── Synthesize drum samples ─────────────────────────────────

function synthesizeDrum(name) {
    var sr = 44100;
    var duration = name === 'kick' ? 0.4 : name === 'snare' ? 0.2 : name === 'clap' ? 0.15 : 0.08;
    var ctx = new OfflineAudioContext(1, sr * duration, sr);

    if (name === 'kick') {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, 0);
        osc.frequency.exponentialRampToValueAtTime(40, 0.12);
        gain.gain.setValueAtTime(0.8, 0);
        gain.gain.exponentialRampToValueAtTime(0.001, duration);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
    } else if (name === 'snare') {
        var bufSize = sr * duration;
        var noiseBuffer = ctx.createBuffer(1, bufSize, sr);
        var data = noiseBuffer.getChannelData(0);
        for (var i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
        var noise = ctx.createBufferSource();
        noise.buffer = noiseBuffer;
        var noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.5, 0);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, duration);
        var hp = ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 2000;
        noise.connect(hp).connect(noiseGain).connect(ctx.destination);
        noise.start();
        var osc2 = ctx.createOscillator();
        var gain2 = ctx.createGain();
        osc2.frequency.value = 180;
        gain2.gain.setValueAtTime(0.4, 0);
        gain2.gain.exponentialRampToValueAtTime(0.001, 0.08);
        osc2.connect(gain2).connect(ctx.destination);
        osc2.start();
    } else if (name === 'hihat') {
        var bufSize2 = sr * duration;
        var noiseBuf2 = ctx.createBuffer(1, bufSize2, sr);
        var d2 = noiseBuf2.getChannelData(0);
        for (var j = 0; j < bufSize2; j++) d2[j] = Math.random() * 2 - 1;
        var noise2 = ctx.createBufferSource();
        noise2.buffer = noiseBuf2;
        var g2 = ctx.createGain();
        g2.gain.setValueAtTime(0.3, 0);
        g2.gain.exponentialRampToValueAtTime(0.001, duration);
        var hp2 = ctx.createBiquadFilter();
        hp2.type = 'highpass'; hp2.frequency.value = 7000;
        noise2.connect(hp2).connect(g2).connect(ctx.destination);
        noise2.start();
    } else if (name === 'clap') {
        var bufSize3 = sr * duration;
        var noiseBuf3 = ctx.createBuffer(1, bufSize3, sr);
        var d3 = noiseBuf3.getChannelData(0);
        for (var k = 0; k < bufSize3; k++) {
            var t = k / sr;
            var env = Math.exp(-t * 40) + 0.6 * Math.exp(-(t - 0.02) * 40) * (t > 0.02 ? 1 : 0);
            d3[k] = (Math.random() * 2 - 1) * env;
        }
        var noise3 = ctx.createBufferSource();
        noise3.buffer = noiseBuf3;
        var bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 1;
        var g3 = ctx.createGain(); g3.gain.value = 0.5;
        noise3.connect(bp).connect(g3).connect(ctx.destination);
        noise3.start();
    }

    return ctx.startRendering();
}

function audioBufferToWav(buffer) {
    var samples = buffer.getChannelData(0);
    var sr = buffer.sampleRate;
    var dataSize = samples.length * 2;
    var ab = new ArrayBuffer(44 + dataSize);
    var v = new DataView(ab);

    function ws(off, s) { for (var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); }
    ws(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true);
    ws(8, 'WAVE'); ws(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    ws(36, 'data'); v.setUint32(40, dataSize, true);
    for (var i = 0; i < samples.length; i++) {
        var s = Math.max(-1, Math.min(1, samples[i]));
        v.setInt16(44 + i * 2, s * 0x7FFF, true);
    }
    return new Uint8Array(ab);
}

// Generate all samples and write to VFS
await Promise.all(INSTRUMENTS.map(function(name) {
    return synthesizeDrum(name).then(function(buffer) {
        var wav = audioBufferToWav(buffer);
        ck.createFile('/audio/' + name + '.wav', wav);
    });
}));
ck.setInt('samplesReady', 1);
ck.broadcastEvent('samplesLoaded');

// ── Restore saved pattern ───────────────────────────────────

var saved = await ck.load('drumPattern');
if (saved) {
    try {
        var parsed = JSON.parse(saved);
        INSTRUMENTS.forEach(function(name) {
            if (parsed[name]) patterns[name] = parsed[name];
        });
    } catch (e) {}
}

// ── Build grid ──────────────────────────────────────────────

var gridEl = document.getElementById('drum-grid');
for (var r = 0; r < INSTRUMENTS.length; r++) {
    var row = document.createElement('div');
    row.className = 'drum-row';
    row.innerHTML = '<span class="drum-label">' + INSTRUMENTS[r].toUpperCase() + '</span>';
    for (var c = 0; c < NUM_STEPS; c++) {
        var btn = document.createElement('button');
        btn.className = 'drum-cell';
        btn.dataset.inst = INSTRUMENTS[r];
        btn.dataset.step = c;
        row.appendChild(btn);
    }
    gridEl.appendChild(row);
}

var cells = gridEl.querySelectorAll('.drum-cell');

function renderGrid() {
    cells.forEach(function(cell) {
        var inst = cell.dataset.inst;
        var step = parseInt(cell.dataset.step);
        cell.classList.toggle('active', !!patterns[inst][step]);
    });
}

function sendAllPatterns() {
    INSTRUMENTS.forEach(function(name) {
        ck.setIntArray('pattern_' + name, patterns[name]);
    });
}

cells.forEach(function(cell) {
    cell.addEventListener('click', function() {
        var inst = cell.dataset.inst;
        var step = parseInt(cell.dataset.step);
        patterns[inst][step] = patterns[inst][step] ? 0 : 1;
        cell.classList.toggle('active');
        ck.setIntArray('pattern_' + inst, patterns[inst]);
    });
});

// BPM
var bpmSlider = document.getElementById('bpm-slider');
var bpmVal = document.getElementById('bpm-val');
bpmSlider.addEventListener('input', function() {
    bpmVal.textContent = bpmSlider.value;
    ck.setFloat('bpm', Number(bpmSlider.value));
});

// Save
document.getElementById('drum-save').addEventListener('click', function() {
    ck.save('drumPattern', JSON.stringify(patterns));
});

// Clear
document.getElementById('drum-clear').addEventListener('click', function() {
    INSTRUMENTS.forEach(function(name) {
        patterns[name] = new Array(NUM_STEPS).fill(0);
    });
    sendAllPatterns();
    renderGrid();
});

// Step highlight (ChucK -> JS)
ck.listenForEvent('step', function() {
    ck.getInt('currentStep').then(function(step) {
        cells.forEach(function(c) { c.classList.remove('playing'); });
        cells.forEach(function(c) {
            if (parseInt(c.dataset.step) === step) c.classList.add('playing');
        });
    });
});

// Send initial values
ck.setFloat('bpm', 120);
sendAllPatterns();
renderGrid();
