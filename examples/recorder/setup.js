// Recorder Example: Capture ChucK audio output via MediaRecorder

(function() {
    'use strict';

    var recorder = null;
    var chunks = [];
    var startTime = 0;
    var timerInterval = null;

    // ── Build HTML panel ──────────────────────────────────────────────
    var panel = document.createElement('div');
    panel.id = 'rec-panel';

    panel.innerHTML = [
        '<button id="rec-btn">Record</button>',
        '<button id="rec-stop" disabled>Stop</button>',
        '<span id="rec-timer">0.0s</span>',
        '<div id="rec-downloads"></div>'
    ].join('');

    var style = document.createElement('style');
    style.textContent = [
        '#rec-panel { position:fixed;top:10px;right:10px;z-index:50;',
        '  background:rgba(15,15,25,0.92);border-radius:8px;padding:10px 14px;',
        '  font:12px monospace;color:#ccc;display:flex;align-items:center;gap:8px;',
        '  flex-wrap:wrap;box-shadow:0 2px 12px rgba(0,0,0,0.5); }',
        '#rec-btn, #rec-stop { padding:5px 12px;border:1px solid #555;border-radius:4px;',
        '  font:12px monospace;cursor:pointer;background:#222;color:#ccc; }',
        '#rec-btn:hover:not(:disabled) { background:#600;color:#faa;border-color:#a44; }',
        '#rec-stop:hover:not(:disabled) { background:#333; }',
        '#rec-btn:disabled, #rec-stop:disabled { opacity:0.4;cursor:default; }',
        '#rec-btn.recording { background:#b00;color:#fff;border-color:#f44; }',
        '#rec-timer { color:#888;min-width:48px; }',
        '#rec-downloads { width:100%; }',
        '#rec-downloads a { display:block;color:#4af;font-size:11px;margin-top:4px; }'
    ].join('\n');

    document.head.appendChild(style);
    document.body.appendChild(panel);

    var btnRec = document.getElementById('rec-btn');
    var btnStop = document.getElementById('rec-stop');
    var timerEl = document.getElementById('rec-timer');
    var downloadsEl = document.getElementById('rec-downloads');
    var recordingCount = 0;

    // ── Wait for audio system to be ready ─────────────────────────────
    function waitForAudio(callback) {
        var check = setInterval(function() {
            if (window.audioCtx && window.audioNode) {
                clearInterval(check);
                callback(window.audioCtx, window.audioNode);
            }
        }, 100);
    }

    waitForAudio(function(ctx, node) {
        var dest = ctx.createMediaStreamDestination();
        node.connect(dest);

        var mimeType = '';
        var ext = 'webm';
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
            mimeType = 'audio/webm;codecs=opus';
            ext = 'webm';
        } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
            mimeType = 'audio/ogg;codecs=opus';
            ext = 'ogg';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
            mimeType = 'audio/mp4';
            ext = 'mp4';
        }

        btnRec.addEventListener('click', function() {
            if (recorder && recorder.state === 'recording') return;

            chunks = [];
            var opts = {};
            if (mimeType) opts.mimeType = mimeType;
            recorder = new MediaRecorder(dest.stream, opts);

            recorder.ondataavailable = function(e) {
                if (e.data.size > 0) chunks.push(e.data);
            };

            recorder.onstop = function() {
                var blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
                var url = URL.createObjectURL(blob);

                recordingCount++;
                var a = document.createElement('a');
                a.href = url;
                a.download = 'recording-' + recordingCount + '.' + ext;
                a.textContent = a.download + ' (' + (blob.size / 1024).toFixed(0) + ' KB)';
                downloadsEl.appendChild(a);

                // Auto-download
                a.click();
            };

            recorder.start(100); // collect data every 100ms
            startTime = Date.now();

            timerInterval = setInterval(function() {
                var elapsed = (Date.now() - startTime) / 1000;
                timerEl.textContent = elapsed.toFixed(1) + 's';
                CK.setFloat('recordingTime', elapsed);
            }, 100);

            btnRec.classList.add('recording');
            btnRec.textContent = 'Recording...';
            btnRec.disabled = true;
            btnStop.disabled = false;
            CK.setInt('isRecording', 1);
        });

        btnStop.addEventListener('click', function() {
            if (!recorder || recorder.state !== 'recording') return;

            recorder.stop();
            clearInterval(timerInterval);

            btnRec.classList.remove('recording');
            btnRec.textContent = 'Record';
            btnRec.disabled = false;
            btnStop.disabled = true;
            CK.setInt('isRecording', 0);
            CK.setFloat('recordingTime', 0);
            timerEl.textContent = '0.0s';
        });

        console.log('[Example: recorder] Ready (format: ' + (mimeType || 'default') + ')');
    });
})();
