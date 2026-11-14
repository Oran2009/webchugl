import ChuGL from 'https://cdn.jsdelivr.net/npm/webchugl/+esm';

var ck = await ChuGL.init({
    canvas: document.getElementById('canvas'),
});

await ck.runFile('./main.ck');

// ── Wikipedia EventStream SSE ───────────────────────────────

var SSE_URL = 'https://stream.wikimedia.org/v2/stream/recentchange';
var MIN_INTERVAL = 200;
var lastSend = 0;

var status = document.createElement('div');
status.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:50;' +
    'font:11px monospace;color:#888;background:rgba(0,0,0,0.6);' +
    'padding:4px 8px;border-radius:4px;';
status.textContent = 'Connecting to Wikipedia...';
document.body.appendChild(status);

var editCount = 0;
var source = new EventSource(SSE_URL);

source.onopen = function() {
    status.textContent = 'Connected to Wikipedia EventStream';
    status.style.color = '#4f4';
};

source.onerror = function() {
    status.textContent = 'SSE disconnected — reconnecting...';
    status.style.color = '#f44';
};

// Close the SSE connection when the page unloads
window.addEventListener('beforeunload', function() { source.close(); });

source.onmessage = function(event) {
    var now = Date.now();
    if (now - lastSend < MIN_INTERVAL) return;
    lastSend = now;

    try { var data = JSON.parse(event.data); }
    catch (e) { return; }

    if (data.bot) return;

    var editSize = 0;
    if (data.length && data.length.new != null && data.length.old != null) {
        editSize = data.length.new - data.length.old;
    }

    var typeMap = { edit: 0, new: 1, categorize: 2, log: 3 };
    var editType = typeMap[data.type] != null ? typeMap[data.type] : 0;

    ck.setString('editTitle', data.title || '');
    ck.setString('editUser', data.user || '');
    ck.setString('editWiki', data.wiki || '');
    ck.setInt('editSize', editSize);
    ck.setInt('editType', editType);
    ck.broadcastEvent('newEdit');

    editCount++;
    status.textContent = 'Wikipedia edits received: ' + editCount;
};
