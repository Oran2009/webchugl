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
    },

    printErr: function(text) {
        console.error(text);
    },

    setStatus: function(text) {
        if (!text) {
            // Loading complete — but don't hide loading screen here.
            // The WebGPU success path in onRuntimeInitialized hides it
            // explicitly. Hiding here would also hide error-text if an
            // error is being displayed (e.g. no WebGPU support).
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
                document.getElementById('progress-bar').style.display = 'none';
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
                _initSensors();
            });
        }).catch(function(e) {
            console.error('WebGPU pre-init failed:', e);
            document.getElementById('progress-bar').style.display = 'none';
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
                var msg = (err && err.message) ? err.message : String(err);
                console.error('[WebChuGL] ' + msg);
                document.getElementById('progress-bar').style.display = 'none';
                var errEl = document.getElementById('error-text');
                errEl.textContent = 'Failed to load files: ' + msg;
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
// CK: Host ↔ ChucK bridge
// Setters are fire-and-forget. Getters return Promises (resolved on next VM
// tick). Event listeners use persistent callbacks.
// ============================================================================

// Callback infrastructure for async getters and event listeners
var _ckNextId = 1;
Module._ckCallbacks = {};       // one-shot: getter Promises (auto-deleted)
Module._ckEventListeners = {};  // persistent: event listener callbacks

window.CK = {

    // ── Scalar setters ────────────────────────────────────────────────────

    setInt: function(name, val) {
        Module.ccall('ck_set_int', 'number', ['string', 'number'], [name, val]);
    },
    setFloat: function(name, val) {
        Module.ccall('ck_set_float', 'number', ['string', 'number'], [name, val]);
    },
    setString: function(name, val) {
        Module.ccall('ck_set_string', 'number', ['string', 'string'], [name, val]);
    },

    // ── Scalar getters (Promise-based) ────────────────────────────────────

    getInt: function(name) {
        return new Promise(function(resolve) {
            var id = _ckNextId++;
            Module._ckCallbacks[id] = resolve;
            Module.ccall('ck_get_int', 'number', ['string', 'number'], [name, id]);
        });
    },
    getFloat: function(name) {
        return new Promise(function(resolve) {
            var id = _ckNextId++;
            Module._ckCallbacks[id] = resolve;
            Module.ccall('ck_get_float', 'number', ['string', 'number'], [name, id]);
        });
    },
    getString: function(name) {
        return new Promise(function(resolve) {
            var id = _ckNextId++;
            Module._ckCallbacks[id] = resolve;
            Module.ccall('ck_get_string', 'number', ['string', 'number'], [name, id]);
        });
    },

    // ── Events ────────────────────────────────────────────────────────────

    signalEvent: function(name) {
        Module.ccall('ck_signal_event', 'number', ['string'], [name]);
    },
    broadcastEvent: function(name) {
        Module.ccall('ck_broadcast_event', 'number', ['string'], [name]);
    },
    listenForEvent: function(name, callback) {
        var id = _ckNextId++;
        Module._ckEventListeners[id] = { callback: callback, once: false };
        Module.ccall('ck_listen_event', 'number',
            ['string', 'number', 'number'], [name, id, 1]);
        return id;
    },
    listenForEventOnce: function(name, callback) {
        var id = _ckNextId++;
        Module._ckEventListeners[id] = { callback: callback, once: true };
        Module.ccall('ck_listen_event', 'number',
            ['string', 'number', 'number'], [name, id, 0]);
        return id;
    },
    stopListeningForEvent: function(name, listenerId) {
        delete Module._ckEventListeners[listenerId];
        Module.ccall('ck_stop_listening_event', 'number',
            ['string', 'number'], [name, listenerId]);
    },

    // ── Int array operations ──────────────────────────────────────────────

    setIntArray: function(name, jsArray) {
        var len = jsArray.length;
        var bytes = len * 4;
        var ptr = Module._malloc(bytes);
        for (var i = 0; i < len; i++) Module.HEAP32[(ptr >> 2) + i] = jsArray[i];
        Module.ccall('ck_set_int_array', 'number',
            ['string', 'number', 'number'], [name, ptr, len]);
        Module._free(ptr);
    },
    setIntArrayValue: function(name, index, value) {
        Module.ccall('ck_set_int_array_value', 'number',
            ['string', 'number', 'number'], [name, index, value]);
    },
    setAssocIntArrayValue: function(name, key, value) {
        Module.ccall('ck_set_assoc_int_array_value', 'number',
            ['string', 'string', 'number'], [name, key, value]);
    },
    getIntArray: function(name) {
        return new Promise(function(resolve) {
            var id = _ckNextId++;
            Module._ckCallbacks[id] = resolve;
            Module.ccall('ck_get_int_array', 'number',
                ['string', 'number'], [name, id]);
        });
    },
    getIntArrayValue: function(name, index) {
        return new Promise(function(resolve) {
            var id = _ckNextId++;
            Module._ckCallbacks[id] = resolve;
            Module.ccall('ck_get_int_array_value', 'number',
                ['string', 'number', 'number'], [name, index, id]);
        });
    },
    getAssocIntArrayValue: function(name, key) {
        return new Promise(function(resolve) {
            var id = _ckNextId++;
            Module._ckCallbacks[id] = resolve;
            Module.ccall('ck_get_assoc_int_array_value', 'number',
                ['string', 'string', 'number'], [name, key, id]);
        });
    },

    // ── Float array operations ────────────────────────────────────────────

    setFloatArray: function(name, jsArray) {
        var len = jsArray.length;
        var bytes = len * 8;
        var ptr = Module._malloc(bytes);
        for (var i = 0; i < len; i++) Module.HEAPF64[(ptr >> 3) + i] = jsArray[i];
        Module.ccall('ck_set_float_array', 'number',
            ['string', 'number', 'number'], [name, ptr, len]);
        Module._free(ptr);
    },
    setFloatArrayValue: function(name, index, value) {
        Module.ccall('ck_set_float_array_value', 'number',
            ['string', 'number', 'number'], [name, index, value]);
    },
    setAssocFloatArrayValue: function(name, key, value) {
        Module.ccall('ck_set_assoc_float_array_value', 'number',
            ['string', 'string', 'number'], [name, key, value]);
    },
    getFloatArray: function(name) {
        return new Promise(function(resolve) {
            var id = _ckNextId++;
            Module._ckCallbacks[id] = resolve;
            Module.ccall('ck_get_float_array', 'number',
                ['string', 'number'], [name, id]);
        });
    },
    getFloatArrayValue: function(name, index) {
        return new Promise(function(resolve) {
            var id = _ckNextId++;
            Module._ckCallbacks[id] = resolve;
            Module.ccall('ck_get_float_array_value', 'number',
                ['string', 'number', 'number'], [name, index, id]);
        });
    },
    getAssocFloatArrayValue: function(name, key) {
        return new Promise(function(resolve) {
            var id = _ckNextId++;
            Module._ckCallbacks[id] = resolve;
            Module.ccall('ck_get_assoc_float_array_value', 'number',
                ['string', 'string', 'number'], [name, key, id]);
        });
    }
};

// ============================================================================
// Device Sensors (Accelerometer + Gyroscope)
// Bridges browser DeviceMotionEvent / DeviceOrientationEvent to ChucK globals.
// ChucK classes (Accel, AccelMsg, Gyro, GyroMsg) are compiled into the VM
// by C++ before user code — this JS side just pushes sensor data.
// ============================================================================

function _initSensors() {
    // Accumulate latest sensor readings; push to ChucK once per frame
    var accelPending = null;
    var gyroPending = null;

    function flushSensors() {
        if (accelPending) {
            CK.setFloat('_accelX', accelPending.x);
            CK.setFloat('_accelY', accelPending.y);
            CK.setFloat('_accelZ', accelPending.z);
            CK.broadcastEvent('_accelReading');
            accelPending = null;
        }
        if (gyroPending) {
            CK.setFloat('_gyroX', gyroPending.alpha);
            CK.setFloat('_gyroY', gyroPending.beta);
            CK.setFloat('_gyroZ', gyroPending.gamma);
            CK.broadcastEvent('_gyroReading');
            gyroPending = null;
        }
        requestAnimationFrame(flushSensors);
    }
    requestAnimationFrame(flushSensors);

    // Accelerometer: devicemotion → accumulate latest reading
    if (window.DeviceMotionEvent) {
        var handleMotion = function(e) {
            var a = e.accelerationIncludingGravity;
            if (!a) return;
            accelPending = { x: a.x || 0, y: a.y || 0, z: a.z || 0 };
        };

        // iOS 13+ requires explicit permission from a user gesture
        if (typeof DeviceMotionEvent.requestPermission === 'function') {
            var requestAccelPermission = function() {
                DeviceMotionEvent.requestPermission().then(function(state) {
                    if (state === 'granted') {
                        window.addEventListener('devicemotion', handleMotion);
                    }
                }).catch(function() {});
            };
            document.addEventListener('click', requestAccelPermission, { once: true });
            document.addEventListener('touchend', requestAccelPermission, { once: true });
        } else {
            window.addEventListener('devicemotion', handleMotion);
        }
    }

    // Gyroscope: deviceorientation → accumulate latest reading
    if (window.DeviceOrientationEvent) {
        var handleOrientation = function(e) {
            gyroPending = { alpha: e.alpha || 0, beta: e.beta || 0, gamma: e.gamma || 0 };
        };

        // iOS 13+ requires explicit permission from a user gesture
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            var requestGyroPermission = function() {
                DeviceOrientationEvent.requestPermission().then(function(state) {
                    if (state === 'granted') {
                        window.addEventListener('deviceorientation', handleOrientation);
                    }
                }).catch(function() {});
            };
            document.addEventListener('click', requestGyroPermission, { once: true });
            document.addEventListener('touchend', requestGyroPermission, { once: true });
        } else {
            window.addEventListener('deviceorientation', handleOrientation);
        }
    }
}

// ============================================================================
// Audio System (JS AudioWorkletProcessor + SharedArrayBuffer ring buffers)
// Called from C++ initAudio() via EM_ASM
// ============================================================================

window.initWebChuGLAudio = function(sab, outBufPtr, outWritePosPtr, outReadPosPtr,
                                     inBufPtr, inWritePosPtr, inReadPosPtr,
                                     capacity, needsMic) {
    var ctx;
    try {
        ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    } catch (e) {
        console.error('[WebChuGL] Failed to create AudioContext: ' + e.message);
        return;
    }

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
        // Keep retrying until context is running (some browsers need gesture on canvas)
        var startAudio = function() {
            if (ctx.state === 'running') {
                document.removeEventListener('click', startAudio);
                document.removeEventListener('keydown', startAudio);
                document.removeEventListener('touchstart', startAudio);
                return;
            }
            ctx.resume();
        };
        document.addEventListener('click', startAudio);
        document.addEventListener('keydown', startAudio);
        document.addEventListener('touchstart', startAudio);

        console.log('[WebChuGL] Audio initialized (JS AudioWorklet)');
    }).catch(function(err) {
        console.error('[WebChuGL] Audio worklet failed: ' + err.message);
    });
};
