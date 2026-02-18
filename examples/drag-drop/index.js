import ChuGL from '../webchugl/webchugl-esm.js';

var ck = await ChuGL.init({
    canvas: document.getElementById('canvas'),
    whereIsChuGL: '../webchugl/',
});

await ck.runFile('./main.ck');

// ── Drop zone overlay ───────────────────────────────────────

var fileCount = 0;

var overlay = document.createElement('div');
overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:200;' +
    'display:none;align-items:center;justify-content:center;' +
    'background:rgba(0,0,0,0.7);pointer-events:none;';
overlay.innerHTML = '<div style="color:#fff;font:24px monospace;text-align:center;' +
    'border:3px dashed #888;padding:40px 60px;border-radius:12px;">' +
    'Drop audio files here</div>';
document.body.appendChild(overlay);

var fileList = document.createElement('div');
fileList.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:50;' +
    'font:11px monospace;color:#aaa;background:rgba(0,0,0,0.6);' +
    'padding:6px 10px;border-radius:4px;max-height:150px;overflow-y:auto;';
fileList.textContent = 'Drag audio files onto this page';
document.body.appendChild(fileList);

// ── Drag events ─────────────────────────────────────────────

var dragCounter = 0;

document.addEventListener('dragenter', function(e) {
    e.preventDefault();
    dragCounter++;
    overlay.style.display = 'flex';
});

document.addEventListener('dragleave', function(e) {
    e.preventDefault();
    if (--dragCounter <= 0) { dragCounter = 0; overlay.style.display = 'none'; }
});

document.addEventListener('dragover', function(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
});

document.addEventListener('drop', function(e) {
    e.preventDefault();
    dragCounter = 0;
    overlay.style.display = 'none';
    for (var i = 0; i < e.dataTransfer.files.length; i++) processFile(e.dataTransfer.files[i]);
});

function processFile(file) {
    if (file.type && !file.type.startsWith('audio/')) return;

    var blobUrl = URL.createObjectURL(file);
    var vfsPath = '/audio/' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');

    addFileToList(file.name, 'loading...');

    ck.loadAudio(blobUrl, vfsPath)
        .then(function(path) {
            URL.revokeObjectURL(blobUrl);
            fileCount++;
            updateFileInList(file.name, 'ready');
            ck.setString('loadedFile', path);
            ck.setInt('fileCount', fileCount);
            ck.broadcastEvent('fileLoaded');
        })
        .catch(function(err) {
            URL.revokeObjectURL(blobUrl);
            updateFileInList(file.name, 'error');
        });
}

function addFileToList(name, status) {
    if (fileCount === 0 && fileList.childNodes.length === 1 &&
        fileList.childNodes[0].nodeType === 3) {
        fileList.textContent = '';
    }
    var row = document.createElement('div');
    row.id = 'file-' + name.replace(/\W/g, '_');
    row.textContent = name + ' [' + status + ']';
    row.style.color = '#888';
    fileList.appendChild(row);
}

function updateFileInList(name, status) {
    var row = document.getElementById('file-' + name.replace(/\W/g, '_'));
    if (row) {
        row.textContent = name + ' [' + status + ']';
        row.style.color = status === 'ready' ? '#4f4' : '#f44';
    }
}
