// HTML UI Example: DOM controls driving ChucK synth parameters

(function() {
    'use strict';

    var panel = document.createElement('div');
    panel.id = 'synth-panel';
    panel.innerHTML = [
        '<div id="synth-header">',
        '  <span>Synth Controls</span>',
        '  <button id="synth-toggle">_</button>',
        '</div>',
        '<div id="synth-body">',
        '  <label>Waveform',
        '    <select id="ctl-wave">',
        '      <option value="0">Sine</option>',
        '      <option value="1">Triangle</option>',
        '      <option value="2" selected>Saw</option>',
        '      <option value="3">Square</option>',
        '    </select>',
        '  </label>',
        '  <label>Frequency <span id="val-freq">440</span> Hz',
        '    <input type="range" id="ctl-freq" min="50" max="2000" value="440" step="1">',
        '  </label>',
        '  <label>Gain <span id="val-gain">0.20</span>',
        '    <input type="range" id="ctl-gain" min="0" max="100" value="20" step="1">',
        '  </label>',
        '  <label>Filter Cutoff <span id="val-filter">2000</span> Hz',
        '    <input type="range" id="ctl-filter" min="100" max="8000" value="2000" step="10">',
        '  </label>',
        '  <label>Reverb <span id="val-reverb">0.10</span>',
        '    <input type="range" id="ctl-reverb" min="0" max="100" value="10" step="1">',
        '  </label>',
        '  <button id="ctl-random">Randomize</button>',
        '</div>'
    ].join('\n');

    var style = document.createElement('style');
    style.textContent = [
        '#synth-panel {',
        '  position: fixed; top: 12px; right: 12px; z-index: 50;',
        '  background: rgba(20,20,30,0.92); color: #eee;',
        '  font: 12px/1.6 monospace; border-radius: 6px;',
        '  min-width: 220px; user-select: none;',
        '  box-shadow: 0 2px 12px rgba(0,0,0,0.5);',
        '}',
        '#synth-header {',
        '  display: flex; justify-content: space-between; align-items: center;',
        '  padding: 6px 10px; background: rgba(255,255,255,0.06);',
        '  border-radius: 6px 6px 0 0; cursor: default;',
        '}',
        '#synth-header span { font-weight: bold; font-size: 13px; }',
        '#synth-toggle {',
        '  background: none; border: 1px solid #555; color: #aaa;',
        '  width: 22px; height: 22px; border-radius: 3px; cursor: pointer;',
        '  font: 12px monospace; line-height: 1;',
        '}',
        '#synth-toggle:hover { border-color: #888; color: #fff; }',
        '#synth-body { padding: 8px 10px; }',
        '#synth-body label {',
        '  display: block; margin-bottom: 8px; font-size: 11px; color: #aaa;',
        '}',
        '#synth-body label span { color: #f0c040; }',
        '#synth-body input[type=range] {',
        '  width: 100%; margin-top: 2px; accent-color: #f0c040;',
        '}',
        '#synth-body select {',
        '  display: block; width: 100%; margin-top: 2px;',
        '  background: #222; color: #eee; border: 1px solid #444;',
        '  padding: 3px; font: 12px monospace; border-radius: 3px;',
        '}',
        '#ctl-random {',
        '  width: 100%; margin-top: 4px; padding: 6px;',
        '  background: #333; color: #eee; border: 1px solid #555;',
        '  font: 12px monospace; border-radius: 3px; cursor: pointer;',
        '}',
        '#ctl-random:hover { background: #444; border-color: #888; }',
        '#synth-body.collapsed { display: none; }'
    ].join('\n');

    document.head.appendChild(style);
    document.body.appendChild(panel);

    // ── Wire up controls ────────────────────────────────────────────
    var elWave   = document.getElementById('ctl-wave');
    var elFreq   = document.getElementById('ctl-freq');
    var elGain   = document.getElementById('ctl-gain');
    var elFilter = document.getElementById('ctl-filter');
    var elReverb = document.getElementById('ctl-reverb');
    var elRandom = document.getElementById('ctl-random');
    var elToggle = document.getElementById('synth-toggle');
    var elBody   = document.getElementById('synth-body');

    function sendAll() {
        var freq   = Number(elFreq.value);
        var gain   = Number(elGain.value) / 100;
        var filter = Number(elFilter.value);
        var reverb = Number(elReverb.value) / 100;
        var wave   = Number(elWave.value);

        CK.setFloat('frequency', freq);
        CK.setFloat('gain', gain);
        CK.setFloat('filterCutoff', filter);
        CK.setFloat('reverbMix', reverb);
        CK.setInt('waveform', wave);

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

    elRandom.addEventListener('click', function() {
        elFreq.value   = Math.floor(Math.random() * 1950 + 50);
        elGain.value   = Math.floor(Math.random() * 80 + 5);
        elFilter.value = Math.floor(Math.random() * 7900 + 100);
        elReverb.value = Math.floor(Math.random() * 60);
        elWave.value   = Math.floor(Math.random() * 4);
        sendAll();
    });

    elToggle.addEventListener('click', function() {
        elBody.classList.toggle('collapsed');
        elToggle.textContent = elBody.classList.contains('collapsed') ? '+' : '_';
    });

    // Send initial values
    sendAll();
})();
