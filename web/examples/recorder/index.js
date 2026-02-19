import ChuGL from '../../src/webchugl-esm.js';

var ck = await ChuGL.init({
    canvas: document.getElementById('canvas'),
    whereIsChuGL: '../../src/',
});

await ck.runFile('./main.ck');

// ── Wait for audio system ───────────────────────────────────

var btnRec = document.getElementById('rec-btn');
var btnStop = document.getElementById('rec-stop');
var timerEl = document.getElementById('rec-timer');
var downloadsEl = document.getElementById('rec-downloads');
var recordingCount = 0;

// Audio initializes asynchronously — poll until ready (timeout after 30s)
var checkCount = 0;
var check = setInterval(function() {
    if (!ck.audioContext || !ck.audioNode) {
        if (++checkCount > 300) {
            clearInterval(check);
            console.warn('[Recorder] Audio system did not initialize within 30 seconds');
        }
        return;
    }
    clearInterval(check);
    setupRecorder(ck.audioContext, ck.audioNode);
}, 100);

function setupRecorder(ctx, node) {
    var recorder = null;
    var chunks = [];
    var startTime = 0;
    var timerInterval = null;

    var dest = ctx.createMediaStreamDestination();
    node.connect(dest);

    var mimeType = '';
    var ext = 'webm';
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus'; ext = 'webm';
    } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
        mimeType = 'audio/ogg;codecs=opus'; ext = 'ogg';
    } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4'; ext = 'mp4';
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
            var objUrl = URL.createObjectURL(blob);
            recordingCount++;
            var a = document.createElement('a');
            a.href = objUrl;
            a.download = 'recording-' + recordingCount + '.' + ext;
            a.textContent = a.download + ' (' + (blob.size / 1024).toFixed(0) + ' KB)';
            downloadsEl.appendChild(a);
            a.click();
            // Revoke after a short delay to let the download start
            setTimeout(function() { URL.revokeObjectURL(objUrl); }, 1000);
        };

        recorder.start(100);
        startTime = Date.now();

        timerInterval = setInterval(function() {
            var elapsed = (Date.now() - startTime) / 1000;
            timerEl.textContent = elapsed.toFixed(1) + 's';
            ck.setFloat('recordingTime', elapsed);
        }, 100);

        btnRec.classList.add('recording');
        btnRec.textContent = 'Recording...';
        btnRec.disabled = true;
        btnStop.disabled = false;
        ck.setInt('isRecording', 1);
    });

    btnStop.addEventListener('click', function() {
        if (!recorder || recorder.state !== 'recording') return;

        recorder.stop();
        clearInterval(timerInterval);

        btnRec.classList.remove('recording');
        btnRec.textContent = 'Record';
        btnRec.disabled = false;
        btnStop.disabled = true;
        ck.setInt('isRecording', 0);
        ck.setFloat('recordingTime', 0);
        timerEl.textContent = '0.0s';
    });

    console.log('[Recorder] Ready (format: ' + (mimeType || 'default') + ')');
}
