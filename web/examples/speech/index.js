import ChuGL from 'https://cdn.jsdelivr.net/npm/webchugl/+esm';

var ck = await ChuGL.init({
    canvas: document.getElementById('canvas'),
    whereIsChuGL: '../../src/',
});

await ck.runFile('./main.ck');

// ── Web Speech Recognition ──────────────────────────────────

var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SpeechRecognition) {
    console.error('[Speech] Web Speech API not supported');
    ck.setString('spokenWord', '(Speech API not supported)');
    ck.setInt('command', -2);
    ck.broadcastEvent('wordSpoken');
} else {
    var status = document.createElement('div');
    status.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:50;' +
        'font:12px monospace;color:#4f4;background:rgba(0,0,0,0.7);' +
        'padding:6px 10px;border-radius:4px;';
    status.textContent = 'Mic: starting...';
    document.body.appendChild(status);

    var recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    var commands = {
        'kick': 0, 'bass': 0,
        'snare': 1, 'clap': 1,
        'hi': 2, 'hat': 2, 'high': 2,
        'stop': 3, 'quiet': 3, 'mute': 3,
        'go': 4, 'play': 4, 'start': 4
    };

    recognition.onresult = function(event) {
        var last = event.results[event.results.length - 1];
        if (!last.isFinal) return;

        var transcript = last[0].transcript.trim().toLowerCase();
        var words = transcript.split(/\s+/);
        for (var i = 0; i < words.length; i++) {
            var word = words[i];
            ck.setString('spokenWord', word);
            ck.setInt('command', commands[word] != null ? commands[word] : -1);
            ck.broadcastEvent('wordSpoken');
        }

        status.textContent = 'Mic: "' + transcript + '"';
        status.style.color = '#4f4';
    };

    recognition.onerror = function(event) {
        if (event.error === 'not-allowed') {
            status.textContent = 'Mic: permission denied';
            status.style.color = '#f44';
        } else if (event.error !== 'no-speech') {
            status.textContent = 'Mic: ' + event.error;
            status.style.color = '#fa4';
        }
    };

    recognition.onend = function() {
        try { recognition.start(); } catch (e) {}
    };

    recognition.start();
    status.textContent = 'Mic: listening...';
}
