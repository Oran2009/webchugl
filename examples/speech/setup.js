// Speech Example: Web Speech Recognition → ChucK

(function() {
    'use strict';

    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.error('[Example: speech] Web Speech API not supported in this browser.');
        CK.setString('spokenWord', '(Speech API not supported)');
        CK.setInt('command', -2);
        CK.broadcastEvent('wordSpoken');
        return;
    }

    // Status UI
    var status = document.createElement('div');
    status.id = 'speech-status';
    status.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:50;' +
        'font:12px monospace;color:#4f4;background:rgba(0,0,0,0.7);' +
        'padding:6px 10px;border-radius:4px;';
    status.textContent = 'Mic: starting...';
    document.body.appendChild(status);

    var recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    // Command mapping
    var commands = {
        'kick': 0, 'bass': 0,
        'snare': 1, 'clap': 1,
        'hi': 2, 'hat': 2, 'high': 2,
        'stop': 3, 'quiet': 3, 'mute': 3,
        'go': 4, 'play': 4, 'start': 4
    };

    recognition.onresult = function(event) {
        // Get the latest result
        var last = event.results[event.results.length - 1];
        if (!last.isFinal) return;

        var transcript = last[0].transcript.trim().toLowerCase();
        console.log('[Speech] Recognized:', transcript);

        // Check each word for commands
        var words = transcript.split(/\s+/);
        for (var i = 0; i < words.length; i++) {
            var word = words[i];
            var cmd = commands[word];

            CK.setString('spokenWord', word);
            if (cmd != null) {
                CK.setInt('command', cmd);
            } else {
                CK.setInt('command', -1); // sonify as text
            }
            CK.broadcastEvent('wordSpoken');
        }

        status.textContent = 'Mic: "' + transcript + '"';
        status.style.color = '#4f4';
    };

    recognition.onerror = function(event) {
        console.warn('[Speech] Error:', event.error);
        if (event.error === 'not-allowed') {
            status.textContent = 'Mic: permission denied';
            status.style.color = '#f44';
        } else if (event.error !== 'no-speech') {
            status.textContent = 'Mic: ' + event.error;
            status.style.color = '#fa4';
        }
    };

    recognition.onend = function() {
        // Auto-restart (Speech Recognition stops after silence)
        try { recognition.start(); } catch (e) { /* already started */ }
    };

    recognition.start();
    status.textContent = 'Mic: listening...';
    console.log('[Example: speech] Speech recognition started');
})();
