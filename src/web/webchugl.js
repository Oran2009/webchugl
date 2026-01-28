// WebChuGL Module Configuration
// Sets up the Emscripten Module and handles file loading from manifest

var Module = {
    canvas: (function() {
        var canvas = document.getElementById('canvas');
        canvas.addEventListener('webglcontextlost', function(e) {
            e.preventDefault();
        }, false);
        return canvas;
    })(),

    print: function(text) {
        console.log(text);
        var outputEl = document.getElementById('output');
        if (outputEl) {
            outputEl.textContent += text + '\n';
            if (outputEl.childNodes.length > 100) {
                outputEl.textContent = outputEl.textContent.split('\n').slice(-50).join('\n');
            }
        }
    },

    printErr: function(text) {
        console.error(text);
    },

    setStatus: function(text) {
        var statusEl = document.getElementById('status');
        statusEl.textContent = text;
        if (!text) statusEl.style.display = 'none';
    },

    onRuntimeInitialized: function() {
        document.getElementById('status').style.display = 'none';
        document.getElementById('canvas').focus();
    },

    // Fetch all files from manifest before main() runs
    preRun: [function() {
        Module.addRunDependency('ck-files');

        // Helper to create parent directories
        function ensureDir(path) {
            var parts = path.split('/').slice(0, -1);
            var current = '';
            for (var i = 0; i < parts.length; i++) {
                current += '/' + parts[i];
                try { FS.mkdir(current); } catch(e) {}
            }
        }

        // Check if file is binary
        function isBinary(filename) {
            var ext = filename.split('.').pop().toLowerCase();
            var binaryExts = ['png', 'jpg', 'jpeg', 'gif', 'wav', 'mp3', 'ogg', 'ttf', 'otf', 'woff', 'woff2', 'bin', 'dat'];
            return binaryExts.indexOf(ext) >= 0;
        }

        // Fetch manifest listing all files
        fetch('manifest.json')
            .then(function(response) {
                if (!response.ok) throw new Error('Failed to fetch manifest.json');
                return response.json();
            })
            .then(function(manifest) {
                var files = manifest.files || [];
                console.log('[WebChuGL] Loading ' + files.length + ' file(s)...');

                return Promise.all(files.map(function(file) {
                    return fetch(file)
                        .then(function(response) {
                            if (!response.ok) throw new Error('Failed to fetch ' + file);
                            return isBinary(file) ? response.arrayBuffer() : response.text();
                        })
                        .then(function(content) {
                            ensureDir(file);
                            if (content instanceof ArrayBuffer) {
                                FS.writeFile('/' + file, new Uint8Array(content));
                            } else {
                                FS.writeFile('/' + file, content);
                            }
                            var size = content.byteLength || content.length;
                            console.log('[WebChuGL] Loaded ' + file + ' (' + size + ' bytes)');
                        });
                }));
            })
            .then(function() {
                Module.removeRunDependency('ck-files');
            })
            .catch(function(err) {
                console.error('[WebChuGL] ' + err.message);
                var statusEl = document.getElementById('status');
                statusEl.textContent = 'Failed to load files';
                statusEl.style.color = '#f44';
            });
    }]
};
