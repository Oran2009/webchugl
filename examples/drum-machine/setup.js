// Drum Machine Example: HTML step sequencer -> ChucK, with persistent storage

(function() {
    'use strict';

    var NUM_STEPS = 16;
    var INSTRUMENTS = ['kick', 'snare', 'hihat', 'clap'];
    var patterns = {};
    INSTRUMENTS.forEach(function(name) {
        patterns[name] = new Array(NUM_STEPS).fill(0);
    });

    // ── Synthesize drum samples ─────────────────────────────────────
    // Generate samples using OfflineAudioContext (no external URLs needed)

    function synthesizeDrum(name) {
        var sr = 44100;
        var duration = name === 'kick' ? 0.4 : name === 'snare' ? 0.2 : name === 'clap' ? 0.15 : 0.08;
        var ctx = new OfflineAudioContext(1, sr * duration, sr);

        if (name === 'kick') {
            // Kick: sine with pitch sweep + fast decay
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
            // Snare: noise + sine body
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
            hp.type = 'highpass';
            hp.frequency.value = 2000;
            noise.connect(hp).connect(noiseGain).connect(ctx.destination);
            noise.start();
            // Body
            var osc2 = ctx.createOscillator();
            var gain2 = ctx.createGain();
            osc2.frequency.value = 180;
            gain2.gain.setValueAtTime(0.4, 0);
            gain2.gain.exponentialRampToValueAtTime(0.001, 0.08);
            osc2.connect(gain2).connect(ctx.destination);
            osc2.start();
        } else if (name === 'hihat') {
            // Hihat: high-passed noise, very short
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
            hp2.type = 'highpass';
            hp2.frequency.value = 7000;
            noise2.connect(hp2).connect(g2).connect(ctx.destination);
            noise2.start();
        } else if (name === 'clap') {
            // Clap: filtered noise with double-hit
            var bufSize3 = sr * duration;
            var noiseBuf3 = ctx.createBuffer(1, bufSize3, sr);
            var d3 = noiseBuf3.getChannelData(0);
            for (var k = 0; k < bufSize3; k++) {
                var t = k / sr;
                // Double envelope: hit at 0 and 0.02s
                var env = Math.exp(-t * 40) + 0.6 * Math.exp(-(t - 0.02) * 40) * (t > 0.02 ? 1 : 0);
                d3[k] = (Math.random() * 2 - 1) * env;
            }
            var noise3 = ctx.createBufferSource();
            noise3.buffer = noiseBuf3;
            var bp = ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.value = 1500;
            bp.Q.value = 1;
            var g3 = ctx.createGain();
            g3.gain.value = 0.5;
            noise3.connect(bp).connect(g3).connect(ctx.destination);
            noise3.start();
        }

        return ctx.startRendering();
    }

    // Convert AudioBuffer to WAV and write to WASM VFS
    function audioBufferToWav(buffer) {
        var numCh = buffer.numberOfChannels;
        var sr = buffer.sampleRate;
        var samples = buffer.getChannelData(0);
        var bitsPerSample = 16;
        var bytesPerSample = bitsPerSample / 8;
        var dataSize = samples.length * bytesPerSample;
        var headerSize = 44;
        var arrayBuffer = new ArrayBuffer(headerSize + dataSize);
        var view = new DataView(arrayBuffer);

        function writeString(offset, str) {
            for (var i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
        }

        writeString(0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); // PCM
        view.setUint16(22, 1, true); // mono
        view.setUint32(24, sr, true);
        view.setUint32(28, sr * bytesPerSample, true);
        view.setUint16(32, bytesPerSample, true);
        view.setUint16(34, bitsPerSample, true);
        writeString(36, 'data');
        view.setUint32(40, dataSize, true);

        for (var i = 0; i < samples.length; i++) {
            var s = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(headerSize + i * 2, s * 0x7FFF, true);
        }

        return new Uint8Array(arrayBuffer);
    }

    // ── Generate all samples and write to VFS ───────────────────────
    CK.ready.then(function() {
        var promises = INSTRUMENTS.map(function(name) {
            return synthesizeDrum(name).then(function(buffer) {
                var wav = audioBufferToWav(buffer);
                var path = '/audio/' + name + '.wav';
                // Ensure /audio directory exists
                try { _module.FS.mkdir('/audio'); } catch (e) { /* exists */ }
                _module.FS.writeFile(path, wav);
                console.log('[Drum machine] Wrote', path, '(' + wav.length + ' bytes)');
                return path;
            });
        });

        return Promise.all(promises).then(function() {
            CK.setInt('samplesReady', 1);
            CK.broadcastEvent('samplesLoaded');
            console.log('[Drum machine] All samples ready');
        });
    });

    // ── Restore saved pattern ───────────────────────────────────────
    CK.load('drumPattern').then(function(saved) {
        if (saved) {
            try {
                var parsed = JSON.parse(saved);
                INSTRUMENTS.forEach(function(name) {
                    if (parsed[name]) patterns[name] = parsed[name];
                });
                sendAllPatterns();
                renderGrid();
                console.log('[Drum machine] Restored saved pattern');
            } catch (e) { /* ignore bad data */ }
        }
    });

    // ── Build HTML UI ───────────────────────────────────────────────
    var panel = document.createElement('div');
    panel.id = 'drum-panel';

    var html = '<div id="drum-header">Drum Machine</div>';
    html += '<div id="drum-grid">';
    for (var r = 0; r < INSTRUMENTS.length; r++) {
        html += '<div class="drum-row"><span class="drum-label">' +
                INSTRUMENTS[r].toUpperCase() + '</span>';
        for (var c = 0; c < NUM_STEPS; c++) {
            html += '<button class="drum-cell" data-inst="' + INSTRUMENTS[r] +
                    '" data-step="' + c + '"></button>';
        }
        html += '</div>';
    }
    html += '</div>';
    html += '<div id="drum-controls">';
    html += '<label>BPM <span id="bpm-val">120</span>';
    html += '<input type="range" id="bpm-slider" min="60" max="200" value="120"></label>';
    html += '<button id="drum-save">Save</button>';
    html += '<button id="drum-clear">Clear</button>';
    html += '</div>';
    panel.innerHTML = html;

    var style = document.createElement('style');
    style.textContent = [
        '#drum-panel { position:fixed;bottom:40px;left:50%;transform:translateX(-50%);',
        '  z-index:50;background:rgba(15,15,25,0.94);border-radius:8px;padding:10px;',
        '  font:11px monospace;color:#ccc;box-shadow:0 2px 16px rgba(0,0,0,0.6);',
        '  user-select:none; }',
        '#drum-header { text-align:center;font-weight:bold;margin-bottom:6px;font-size:13px; }',
        '.drum-row { display:flex;align-items:center;margin:2px 0; }',
        '.drum-label { width:44px;text-align:right;padding-right:6px;font-size:10px;color:#888; }',
        '.drum-cell { width:24px;height:24px;margin:1px;border:1px solid #333;',
        '  background:#1a1a2a;border-radius:3px;cursor:pointer;padding:0; }',
        '.drum-cell:hover { border-color:#666; }',
        '.drum-cell.active { background:#f0c040;border-color:#f0c040; }',
        '.drum-cell.playing { box-shadow:0 0 4px #fff; }',
        '#drum-controls { display:flex;align-items:center;gap:10px;margin-top:8px; }',
        '#drum-controls label { flex:1;font-size:10px;color:#888; }',
        '#drum-controls label span { color:#f0c040; }',
        '#drum-controls input[type=range] { width:100%;accent-color:#f0c040; }',
        '#drum-controls button { padding:4px 10px;background:#333;color:#ccc;',
        '  border:1px solid #555;border-radius:3px;font:11px monospace;cursor:pointer; }',
        '#drum-controls button:hover { background:#444; }'
    ].join('\n');

    document.head.appendChild(style);
    document.body.appendChild(panel);

    // ── Grid interaction ────────────────────────────────────────────
    var cells = panel.querySelectorAll('.drum-cell');
    cells.forEach(function(cell) {
        cell.addEventListener('click', function() {
            var inst = cell.dataset.inst;
            var step = parseInt(cell.dataset.step);
            patterns[inst][step] = patterns[inst][step] ? 0 : 1;
            cell.classList.toggle('active');
            CK.setIntArray('pattern_' + inst, patterns[inst]);
        });
    });

    function renderGrid() {
        cells.forEach(function(cell) {
            var inst = cell.dataset.inst;
            var step = parseInt(cell.dataset.step);
            if (patterns[inst][step]) cell.classList.add('active');
            else cell.classList.remove('active');
        });
    }

    function sendAllPatterns() {
        INSTRUMENTS.forEach(function(name) {
            CK.setIntArray('pattern_' + name, patterns[name]);
        });
    }

    // BPM slider
    var bpmSlider = document.getElementById('bpm-slider');
    var bpmVal = document.getElementById('bpm-val');
    bpmSlider.addEventListener('input', function() {
        bpmVal.textContent = bpmSlider.value;
        CK.setFloat('bpm', Number(bpmSlider.value));
    });

    // Save button
    document.getElementById('drum-save').addEventListener('click', function() {
        CK.save('drumPattern', JSON.stringify(patterns)).then(function() {
            console.log('[Drum machine] Pattern saved');
        });
    });

    // Clear button
    document.getElementById('drum-clear').addEventListener('click', function() {
        INSTRUMENTS.forEach(function(name) {
            patterns[name] = new Array(NUM_STEPS).fill(0);
        });
        sendAllPatterns();
        renderGrid();
    });

    // ── Step highlight (ChucK → JS via event) ───────────────────────
    CK.listenForEvent('step', function() {
        CK.getInt('currentStep').then(function(step) {
            // Remove previous highlight
            cells.forEach(function(c) { c.classList.remove('playing'); });
            // Highlight current column
            cells.forEach(function(c) {
                if (parseInt(c.dataset.step) === step) c.classList.add('playing');
            });
        });
    });

    // Send initial values
    CK.setFloat('bpm', 120);
    sendAllPatterns();
    renderGrid();
})();
