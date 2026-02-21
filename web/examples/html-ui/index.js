import ChuGL from 'https://cdn.jsdelivr.net/npm/webchugl/+esm';

var ck = await ChuGL.init({
    canvas: document.getElementById('canvas'),
    whereIsChuGL: '../../src/',
});

await ck.runFile('./main.ck');

// ── Wire up controls ────────────────────────────────────────

var elWave   = document.getElementById('ctl-wave');
var elFreq   = document.getElementById('ctl-freq');
var elGain   = document.getElementById('ctl-gain');
var elFilter = document.getElementById('ctl-filter');
var elReverb = document.getElementById('ctl-reverb');

function sendAll() {
    var freq   = Number(elFreq.value);
    var gain   = Number(elGain.value) / 100;
    var filter = Number(elFilter.value);
    var reverb = Number(elReverb.value) / 100;
    var wave   = Number(elWave.value);

    ck.setFloat('frequency', freq);
    ck.setFloat('gain', gain);
    ck.setFloat('filterCutoff', filter);
    ck.setFloat('reverbMix', reverb);
    ck.setInt('waveform', wave);

    document.getElementById('val-freq').textContent = freq;
    document.getElementById('val-gain').textContent = gain.toFixed(2);
    document.getElementById('val-filter').textContent = filter;
    document.getElementById('val-reverb').textContent = reverb.toFixed(2);
}

elWave.addEventListener('change', sendAll);
elFreq.addEventListener('input', sendAll);
elGain.addEventListener('input', sendAll);
elFilter.addEventListener('input', sendAll);
elReverb.addEventListener('input', sendAll);

document.getElementById('ctl-random').addEventListener('click', function() {
    elFreq.value   = Math.floor(Math.random() * 1950 + 50);
    elGain.value   = Math.floor(Math.random() * 80 + 5);
    elFilter.value = Math.floor(Math.random() * 7900 + 100);
    elReverb.value = Math.floor(Math.random() * 60);
    elWave.value   = Math.floor(Math.random() * 4);
    sendAll();
});

document.getElementById('synth-toggle').addEventListener('click', function() {
    var body = document.getElementById('synth-body');
    body.classList.toggle('collapsed');
    this.textContent = body.classList.contains('collapsed') ? '+' : '_';
});

sendAll();
