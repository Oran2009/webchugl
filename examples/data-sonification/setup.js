// Live Data Example: Wikipedia Edit Sonification

(function() {
    'use strict';

    var SSE_URL = 'https://stream.wikimedia.org/v2/stream/recentchange';
    var MIN_INTERVAL = 200; // ms between forwarded events (rate-limit)
    var lastSend = 0;

    console.log('[Example: live-data] Connecting to Wikipedia EventStream...');

    // Status indicator
    var status = document.createElement('div');
    status.id = 'sse-status';
    status.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:50;' +
        'font:11px monospace;color:#888;background:rgba(0,0,0,0.6);' +
        'padding:4px 8px;border-radius:4px;';
    status.textContent = 'Connecting to Wikipedia...';
    document.body.appendChild(status);

    var editCount = 0;

    var source = new EventSource(SSE_URL);

    source.onopen = function() {
        console.log('[Example: live-data] SSE connected');
        status.textContent = 'Connected to Wikipedia EventStream';
        status.style.color = '#4f4';
    };

    source.onerror = function() {
        status.textContent = 'SSE disconnected — reconnecting...';
        status.style.color = '#f44';
    };

    source.onmessage = function(event) {
        var now = Date.now();
        if (now - lastSend < MIN_INTERVAL) return;
        lastSend = now;

        try {
            var data = JSON.parse(event.data);
        } catch (e) {
            return;
        }

        if (data.bot) return;

        var editSize = 0;
        if (data.length && data.length.new != null && data.length.old != null) {
            editSize = data.length.new - data.length.old;
        }

        var typeMap = { edit: 0, new: 1, categorize: 2, log: 3 };
        var editType = typeMap[data.type] != null ? typeMap[data.type] : 0;

        CK.setString('editTitle', data.title || '');
        CK.setString('editUser', data.user || '');
        CK.setString('editWiki', data.wiki || '');
        CK.setInt('editSize', editSize);
        CK.setInt('editType', editType);
        CK.broadcastEvent('newEdit');

        editCount++;
        status.textContent = 'Wikipedia edits received: ' + editCount;
    };
})();
