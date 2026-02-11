// WebChuGL Module Configuration
// Sets up the Emscripten Module and handles file loading from manifest

var Module = {
    noInitialRun: true,

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
        if (!text) {
            // Loading complete — hide loading screen
            document.getElementById('loading-screen').classList.add('hidden');
            return;
        }
        // Update progress bar based on loading phase
        var fill = document.getElementById('progress-fill');
        if (!fill) return;
        var pct = 0;
        var match;
        if ((match = text.match(/Downloading\.\.\.\s*(\d+)%/))) {
            pct = parseInt(match[1], 10) * 0.7; // download = 0-70%
        } else if (text.indexOf('Extracting') >= 0) {
            pct = 75;
        } else if ((match = text.match(/Loading\s+(\d+)\/(\d+)/))) {
            var done = parseInt(match[1], 10);
            var total = parseInt(match[2], 10);
            pct = 80 + (done / total) * 20; // loading = 80-100%
        }
        fill.style.width = Math.round(pct) + '%';
    },

    // After runtime is ready: pre-init WebGPU, then call main()
    // This avoids the need for ASYNCIFY (which is incompatible with MAIN_MODULE
    // due to ASYNCIFY forcing DYNCALLS=1, which breaks JS library callbacks).
    onRuntimeInitialized: function() {
        if (!navigator.gpu) return;
        navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).then(function(adapter) {
            if (!adapter) {
                var errEl = document.getElementById('error-text');
                errEl.textContent = 'Failed to get WebGPU adapter';
                errEl.style.display = 'block';
                return;
            }
            return adapter.requestDevice().then(function(device) {
                // Store JS objects for C++ to register via EM_ASM
                window._preWebGPUAdapter = adapter;
                window._preWebGPUDevice = device;
                document.getElementById('loading-screen').classList.add('hidden');
                document.getElementById('canvas').focus();
                Module.callMain([]);
            });
        }).catch(function(e) {
            console.error('WebGPU pre-init failed:', e);
            var errEl = document.getElementById('error-text');
            errEl.textContent = 'WebGPU init failed: ' + e.message;
            errEl.style.display = 'block';
        });
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

        // Load JSZip dynamically (in parallel with bundle fetch, off critical render path)
        var jszipReady = new Promise(function(resolve, reject) {
            var s = document.createElement('script');
            s.src = 'jszip.min.js';
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
        });

        // Fetch all files from bundle.zip (compressed) and extract to VFS
        Module.setStatus('Downloading...');
        fetch('bundle.zip')
            .then(function(response) {
                if (!response.ok) throw new Error('Failed to fetch bundle.zip');
                var contentLength = response.headers.get('content-length');
                if (!contentLength || !response.body) {
                    return response.arrayBuffer();
                }
                var total = parseInt(contentLength, 10);
                var loaded = 0;
                var reader = response.body.getReader();
                var chunks = [];
                function read() {
                    return reader.read().then(function(result) {
                        if (result.done) {
                            var combined = new Uint8Array(loaded);
                            var offset = 0;
                            for (var i = 0; i < chunks.length; i++) {
                                combined.set(chunks[i], offset);
                                offset += chunks[i].length;
                            }
                            return combined.buffer;
                        }
                        chunks.push(result.value);
                        loaded += result.value.length;
                        var pct = Math.round(loaded / total * 100);
                        Module.setStatus('Downloading... ' + pct + '%');
                        return read();
                    });
                }
                return read();
            })
            .then(function(zipData) {
                Module.setStatus('Extracting...');
                return jszipReady.then(function() { return JSZip.loadAsync(zipData); });
            })
            .then(function(zip) {
                var entries = Object.keys(zip.files).filter(function(name) {
                    return !zip.files[name].dir;
                });
                var total = entries.length;
                var loaded = 0;
                Module.setStatus('Loading 0/' + total + ' files...');

                return Promise.all(entries.map(function(name) {
                    return zip.files[name].async('arraybuffer').then(function(content) {
                        ensureDir(name);
                        FS.writeFile('/' + name, new Uint8Array(content));
                        loaded++;
                        Module.setStatus('Loading ' + loaded + '/' + total + ' files...');
                    });
                }));
            })
            .then(function() {
                // Scan for ChuGins in the code directory (recursive)
                ChuginLoader.scanForChugins('/code');
                if (ChuginLoader.pendingChugins.length > 0) {
                    console.log('[WebChuGL] Found ' + ChuginLoader.pendingChugins.length + ' ChuGin(s)');
                }
                Module.removeRunDependency('ck-files');
            })
            .catch(function(err) {
                console.error('[WebChuGL] ' + err.message);
                var errEl = document.getElementById('error-text');
                errEl.textContent = 'Failed to load files: ' + err.message;
                errEl.style.display = 'block';
            });
    }]
};

// ============================================================================
// ChuGin Loader
// Scans for .chug.wasm files; actual loading is done via dlopen() in C++
// ============================================================================

var ChuginLoader = {
    pendingChugins: [],

    // Recursively scan directory for .chug.wasm files
    scanForChugins: function(dirPath) {
        try {
            var files = FS.readdir(dirPath);
            for (var i = 0; i < files.length; i++) {
                var file = files[i];
                if (file === '.' || file === '..') continue;
                var fullPath = dirPath + '/' + file;
                try {
                    var stat = FS.stat(fullPath);
                    if (FS.isDir(stat.mode)) {
                        this.scanForChugins(fullPath);
                    } else if (file.endsWith('.chug.wasm')) {
                        this.pendingChugins.push(fullPath);
                        console.log('[ChuginLoader] Found: ' + fullPath);
                    }
                } catch (e) { }
            }
        } catch (e) { }
    },

    getPendingCount: function() {
        return this.pendingChugins.length;
    }
};

window.ChuginLoader = ChuginLoader;

// ============================================================================
// Audio System (JS AudioWorkletProcessor + SharedArrayBuffer ring buffers)
// Called from C++ initAudio() via EM_ASM
// ============================================================================

window.initWebChuGLAudio = function(sab, outBufPtr, outWritePosPtr, outReadPosPtr,
                                     inBufPtr, inWritePosPtr, inReadPosPtr,
                                     capacity, needsMic) {
    var ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });

    ctx.audioWorklet.addModule('audio-worklet-processor.js').then(function() {
        var node = new AudioWorkletNode(ctx, 'chuck-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2]
        });

        // Send ring buffer memory locations to the worklet
        node.port.postMessage({
            sab: sab,
            outBufOffset: outBufPtr,
            outWritePosOffset: outWritePosPtr,
            outReadPosOffset: outReadPosPtr,
            inBufOffset: inBufPtr,
            inWritePosOffset: inWritePosPtr,
            inReadPosOffset: inReadPosPtr,
            capacity: capacity
        });

        node.connect(ctx.destination);

        // Request microphone if ChucK code uses adc
        if (needsMic) {
            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(function(stream) {
                    var source = ctx.createMediaStreamSource(stream);
                    source.connect(node);
                    console.log('[WebChuGL] Microphone connected');
                })
                .catch(function(err) {
                    console.log('[WebChuGL] Microphone not available: ' + err.message);
                });
        }

        // Resume AudioContext on user interaction (autoplay policy)
        var startAudio = function() {
            if (ctx.state !== 'running') {
                ctx.resume();
            }
        };
        document.addEventListener('click', startAudio, { once: true });
        document.addEventListener('keydown', startAudio, { once: true });

        console.log('[WebChuGL] Audio initialized (JS AudioWorklet)');
    }).catch(function(err) {
        console.error('[WebChuGL] Audio worklet failed: ' + err.message);
    });
};
