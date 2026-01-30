// WebChuGL Module Configuration
// Sets up the Emscripten Module, handles file loading, and initializes audio

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

        // Initialize audio after WASM is ready
        WebChuGLAudio.init();
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

// ============================================================================
// WebChuGL Audio System
// JavaScript-based Audio Worklet using SharedArrayBuffer for WASM communication
// ============================================================================

var WebChuGLAudio = {
    audioContext: null,
    workletNode: null,
    initialized: false,

    init: function() {
        if (this.initialized) return;

        // Check if SharedArrayBuffer is available (requires COOP/COEP headers)
        if (typeof SharedArrayBuffer === 'undefined') {
            console.warn('[WebChuGL] SharedArrayBuffer not available. Audio disabled.');
            console.warn('[WebChuGL] Ensure server sends COOP/COEP headers.');
            return;
        }

        // Check if WASM memory is a SharedArrayBuffer
        if (!(Module.HEAPU8.buffer instanceof SharedArrayBuffer)) {
            console.warn('[WebChuGL] WASM memory is not SharedArrayBuffer. Audio disabled.');
            return;
        }

        // Set up audio on user interaction (required by browsers)
        var self = this;
        var startAudio = function() {
            if (!self.audioContext) {
                self.createAudioContext();
            } else if (self.audioContext.state === 'suspended') {
                self.audioContext.resume();
            }
        };

        document.addEventListener('click', startAudio);
        document.addEventListener('keydown', startAudio);

        this.initialized = true;
        console.log('[WebChuGL] Audio system ready (click or press key to start)');
    },

    createAudioContext: function() {
        var self = this;

        // Create AudioContext at 48kHz to match ChucK
        this.audioContext = new AudioContext({ sampleRate: 48000 });

        // Get ring buffer pointers from WASM
        var ringCapacity = Module._getRingCapacity();
        var outputBufferPtr = Module._getOutputRingBuffer();
        var outputWritePosPtr = Module._getOutputRingWritePos();
        var outputReadPosPtr = Module._getOutputRingReadPos();
        var inputBufferPtr = Module._getInputRingBuffer();
        var inputWritePosPtr = Module._getInputRingWritePos();
        var inputReadPosPtr = Module._getInputRingReadPos();

        console.log('[WebChuGL] Ring buffer capacity:', ringCapacity);
        console.log('[WebChuGL] Output buffer ptr:', outputBufferPtr);

        // Load the audio worklet processor
        // We inline the processor code as a Blob to avoid cross-origin issues
        fetch('chugl-audio-processor.js')
            .then(function(response) { return response.text(); })
            .then(function(processorCode) {
                var blob = new Blob([processorCode], { type: 'application/javascript' });
                var url = URL.createObjectURL(blob);
                return self.audioContext.audioWorklet.addModule(url);
            })
            .then(function() {
                // Create the worklet node with WASM memory access
                self.workletNode = new AudioWorkletNode(
                    self.audioContext,
                    'chugl-audio-processor',
                    {
                        numberOfInputs: 1,
                        numberOfOutputs: 1,
                        outputChannelCount: [2],
                        processorOptions: {
                            wasmMemory: Module.HEAPU8.buffer,
                            ringCapacity: ringCapacity,
                            outputBufferPtr: outputBufferPtr,
                            outputWritePosPtr: outputWritePosPtr,
                            outputReadPosPtr: outputReadPosPtr,
                            inputBufferPtr: inputBufferPtr,
                            inputWritePosPtr: inputWritePosPtr,
                            inputReadPosPtr: inputReadPosPtr
                        }
                    }
                );

                // Connect worklet to audio output
                self.workletNode.connect(self.audioContext.destination);
                console.log('[WebChuGL] Audio worklet connected');

                // Try to connect microphone input
                self.connectMicrophone();

                // Hide audio hint
                var audioHint = document.getElementById('audio-hint');
                if (audioHint) {
                    audioHint.classList.add('hidden');
                }
            })
            .catch(function(err) {
                console.error('[WebChuGL] Failed to create audio worklet:', err);
            });
    },

    connectMicrophone: function() {
        var self = this;

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            console.log('[WebChuGL] getUserMedia not available');
            return;
        }

        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(function(stream) {
                var source = self.audioContext.createMediaStreamSource(stream);
                source.connect(self.workletNode);
                console.log('[WebChuGL] Microphone connected');
            })
            .catch(function(err) {
                console.log('[WebChuGL] Microphone not available:', err.message);
            });
    }
};
