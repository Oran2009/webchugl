// WebChuGL Runtime
// Sets up the Emscripten Module, service worker, CK bridge, sensors, and audio.

// ============================================================================
// Service Worker Registration (COOP/COEP headers + offline caching)
// ============================================================================

(function() {
    if (!('serviceWorker' in navigator)) return;

    // Already cross-origin isolated — SW is working, nothing to do
    if (window.crossOriginIsolated) {
        sessionStorage.removeItem('webchugl-sw-reload');
        return;
    }

    // Not secure context — SW won't work
    if (!window.isSecureContext) {
        console.log('[WebChuGL] Service worker requires a secure context (HTTPS or localhost).');
        return;
    }

    // Safety net: prevent infinite reload loops
    var reloadCount = parseInt(sessionStorage.getItem('webchugl-sw-reload') || '0', 10);
    if (reloadCount >= 3) {
        console.warn('[WebChuGL] crossOriginIsolated is still false after ' + reloadCount + ' reloads. Giving up.');
        sessionStorage.removeItem('webchugl-sw-reload');
        return;
    }

    function doReload() {
        sessionStorage.setItem('webchugl-sw-reload', String(reloadCount + 1));
        location.reload();
    }

    navigator.serviceWorker.register('sw.js').then(function(registration) {
        // Hard refresh recovery: SW is active but not controlling this page
        // (hard refresh sets controller to null). A normal reload will go
        // through the active SW which injects COOP/COEP headers.
        if (registration.active && !navigator.serviceWorker.controller) {
            doReload();
            return;
        }

        // First visit / SW update: SW is installing or waiting.
        // Wait for it to activate and claim this client, then reload.
        navigator.serviceWorker.addEventListener('controllerchange', doReload);
    });
})();

// ============================================================================
// Web MIDI
// ============================================================================

function _initMidi(access) {
    window._rtmidi_internals_midi_access = access;
    window._rtmidi_internals_latest_message_timestamp = 0.0;
    window._rtmidi_internals_waiting = false;
    window._rtmidi_internals_get_port_by_number = function(portNumber, isInput) {
        var midi = window._rtmidi_internals_midi_access;
        var devices = isInput ? midi.inputs : midi.outputs;
        var i = 0;
        for (var device of devices.values()) {
            if (i == portNumber) return device;
            i++;
        }
        return null;
    };
}

// MIDI access is requested on-demand by ChucK's RtMidi C++ code when a
// program creates MidiIn/MidiOut. The browser will prompt for permission
// only when needed. Programs can also pre-request MIDI via setup.js by
// calling _initMidi(access) to avoid the async race condition.

// ============================================================================
// Emscripten Module — MODULARIZE factory pattern
// ============================================================================

var _progressFill = document.getElementById('progress-fill');
function _setProgress(pct) {
    if (_progressFill) _progressFill.style.width = Math.round(pct) + '%';
}

// The Module instance, set during preRun and confirmed in .then().
// All runtime code (CK bridge, sensors, etc.) accesses Emscripten through this.
var _module = null;

// Config object passed to the factory. This becomes Module inside the factory
// closure, so properties set here are accessible from C++ via EM_ASM.
var _moduleConfig = {
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

    setStatus: function() {},

    // Callback/event listener maps used by C++ EM_ASM code.
    // Set here so they exist on Module from the start.
    _ckCallbacks: {},
    _ckEventListeners: {},

    // Fetch all files from bundle.zip before main() runs
    preRun: [function(mod) {
        _module = mod;
        mod.addRunDependency('ck-files');

        var jszipReady = new Promise(function(resolve, reject) {
            var s = document.createElement('script');
            s.src = 'webchugl/jszip.min.js';
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
        });

        _setProgress(0);
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
                        _setProgress(Math.round(loaded / total * 100) * 0.7);
                        return read();
                    });
                }
                return read();
            })
            .then(function(zipData) {
                _setProgress(75);
                return jszipReady.then(function() { return JSZip.loadAsync(zipData); });
            })
            .then(function(zip) {
                var entries = Object.keys(zip.files).filter(function(name) {
                    return !zip.files[name].dir;
                });
                var total = entries.length;
                var loaded = 0;
                return Promise.all(entries.map(function(name) {
                    return zip.files[name].async('arraybuffer').then(function(content) {
                        _ensureVfsDir('/' + name);
                        _module.FS.writeFile('/' + name, new Uint8Array(content));
                        loaded++;
                        _setProgress(80 + (loaded / total) * 20);
                    });
                }));
            })
            .then(function() {
                ChuginLoader.scanForChugins('/code');
                if (ChuginLoader.pendingChugins.length > 0) {
                    console.log('[WebChuGL] Found ' + ChuginLoader.pendingChugins.length + ' ChuGin(s)');
                }
                mod.removeRunDependency('ck-files');
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

// Launch the Emscripten module. The promise resolves when the runtime is ready
// (equivalent to onRuntimeInitialized in non-MODULARIZE builds).
createWebChuGL(_moduleConfig).then(function(mod) {
    _module = mod;

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
            _module.callMain([]);
            _initSensors();

            // Flush any CK bridge calls queued before callMain().
            // Global arrays declared with [0] are allocated during
            // callMain(), so no frame delay is needed.
            _ckFlush();
        });
    }).catch(function(e) {
        console.error('WebGPU pre-init failed:', e);
        document.getElementById('progress-bar').style.display = 'none';
        var errEl = document.getElementById('error-text');
        errEl.textContent = 'WebGPU init failed: ' + e.message;
        errEl.style.display = 'block';
    });
});

// ============================================================================
// ChuGin Loader
// Scans for .chug.wasm files; actual loading is done via dlopen() in C++
// ============================================================================

var ChuginLoader = {
    pendingChugins: [],

    // Recursively scan directory for .chug.wasm files
    scanForChugins: function(dirPath) {
        try {
            var fs = _module.FS;
            var files = fs.readdir(dirPath);
            for (var i = 0; i < files.length; i++) {
                var file = files[i];
                if (file === '.' || file === '..') continue;
                var fullPath = dirPath + '/' + file;
                try {
                    var stat = fs.stat(fullPath);
                    if (fs.isDir(stat.mode)) {
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
// ============================================================================

// Callback infrastructure for async getters and event listeners
var _ckNextId = 1;

// ── Deferred call queue ──────────────────────────────────────────────
// CK methods can be called before the WASM module is ready.
// Calls are queued and flushed once callMain() has executed.
var _ckReady = false;
var _ckQueue = [];
var _ckReadyResolve;
var _ckReadyPromise = new Promise(function(r) { _ckReadyResolve = r; });

function _ckDefer(fn) {
    if (_ckReady) fn();
    else _ckQueue.push(fn);
}

function _ckDeferPromise(fn) {
    if (_ckReady) return fn();
    return new Promise(function(resolve, reject) {
        _ckQueue.push(function() { fn().then(resolve, reject); });
    });
}

function _ckFlush() {
    _ckReady = true;
    for (var i = 0; i < _ckQueue.length; i++) _ckQueue[i]();
    _ckQueue = [];
    _ckReadyResolve();
}

window.CK = {

    // Promise that resolves when the CK bridge is ready to use.
    // All methods below auto-queue if called before ready, but this is
    // available for code that wants to explicitly wait:
    //   CK.ready.then(function() { ... });
    ready: _ckReadyPromise,

    // ── Scalar setters ────────────────────────────────────────────────────

    setInt: function(name, val) {
        _ckDefer(function() {
            _module.ccall('ck_set_int', 'number', ['string', 'number'], [name, val]);
        });
    },
    setFloat: function(name, val) {
        _ckDefer(function() {
            _module.ccall('ck_set_float', 'number', ['string', 'number'], [name, val]);
        });
    },
    setString: function(name, val) {
        _ckDefer(function() {
            _module.ccall('ck_set_string', 'number', ['string', 'string'], [name, val]);
        });
    },

    // ── Scalar getters (Promise-based) ────────────────────────────────────

    getInt: function(name) {
        return _ckDeferPromise(function() {
            return new Promise(function(resolve) {
                var id = _ckNextId++;
                _moduleConfig._ckCallbacks[id] = resolve;
                _module.ccall('ck_get_int', 'number', ['string', 'number'], [name, id]);
            });
        });
    },
    getFloat: function(name) {
        return _ckDeferPromise(function() {
            return new Promise(function(resolve) {
                var id = _ckNextId++;
                _moduleConfig._ckCallbacks[id] = resolve;
                _module.ccall('ck_get_float', 'number', ['string', 'number'], [name, id]);
            });
        });
    },
    getString: function(name) {
        return _ckDeferPromise(function() {
            return new Promise(function(resolve) {
                var id = _ckNextId++;
                _moduleConfig._ckCallbacks[id] = resolve;
                _module.ccall('ck_get_string', 'number', ['string', 'number'], [name, id]);
            });
        });
    },

    // ── Events ────────────────────────────────────────────────────────────

    signalEvent: function(name) {
        _ckDefer(function() {
            _module.ccall('ck_signal_event', 'number', ['string'], [name]);
        });
    },
    broadcastEvent: function(name) {
        _ckDefer(function() {
            _module.ccall('ck_broadcast_event', 'number', ['string'], [name]);
        });
    },
    listenForEvent: function(name, callback) {
        var id = _ckNextId++;
        _moduleConfig._ckEventListeners[id] = { callback: callback, once: false };
        _ckDefer(function() {
            _module.ccall('ck_listen_event', 'number',
                ['string', 'number', 'number'], [name, id, 1]);
        });
        return id;
    },
    listenForEventOnce: function(name, callback) {
        var id = _ckNextId++;
        _moduleConfig._ckEventListeners[id] = { callback: callback, once: true };
        _ckDefer(function() {
            _module.ccall('ck_listen_event', 'number',
                ['string', 'number', 'number'], [name, id, 0]);
        });
        return id;
    },
    stopListeningForEvent: function(name, listenerId) {
        delete _moduleConfig._ckEventListeners[listenerId];
        _ckDefer(function() {
            _module.ccall('ck_stop_listening_event', 'number',
                ['string', 'number'], [name, listenerId]);
        });
    },
    // Alias for WebChucK API compatibility
    startListeningForEvent: function(name, callback) {
        return this.listenForEvent(name, callback);
    },

    // ── Int array operations ──────────────────────────────────────────────

    setIntArray: function(name, jsArray) {
        _ckDefer(function() {
            var buf = new Uint8Array(new Int32Array(jsArray).buffer);
            _module.ccall('ck_set_int_array', 'number',
                ['string', 'array', 'number'], [name, buf, jsArray.length]);
        });
    },
    setIntArrayValue: function(name, index, value) {
        _ckDefer(function() {
            _module.ccall('ck_set_int_array_value', 'number',
                ['string', 'number', 'number'], [name, index, value]);
        });
    },
    setAssocIntArrayValue: function(name, key, value) {
        _ckDefer(function() {
            _module.ccall('ck_set_assoc_int_array_value', 'number',
                ['string', 'string', 'number'], [name, key, value]);
        });
    },
    getIntArray: function(name) {
        return _ckDeferPromise(function() {
            return new Promise(function(resolve) {
                var id = _ckNextId++;
                _moduleConfig._ckCallbacks[id] = resolve;
                _module.ccall('ck_get_int_array', 'number',
                    ['string', 'number'], [name, id]);
            });
        });
    },
    getIntArrayValue: function(name, index) {
        return _ckDeferPromise(function() {
            return new Promise(function(resolve) {
                var id = _ckNextId++;
                _moduleConfig._ckCallbacks[id] = resolve;
                _module.ccall('ck_get_int_array_value', 'number',
                    ['string', 'number', 'number'], [name, index, id]);
            });
        });
    },
    getAssocIntArrayValue: function(name, key) {
        return _ckDeferPromise(function() {
            return new Promise(function(resolve) {
                var id = _ckNextId++;
                _moduleConfig._ckCallbacks[id] = resolve;
                _module.ccall('ck_get_assoc_int_array_value', 'number',
                    ['string', 'string', 'number'], [name, key, id]);
            });
        });
    },

    // ── Float array operations ────────────────────────────────────────────

    setFloatArray: function(name, jsArray) {
        _ckDefer(function() {
            var buf = new Uint8Array(new Float64Array(jsArray).buffer);
            _module.ccall('ck_set_float_array', 'number',
                ['string', 'array', 'number'], [name, buf, jsArray.length]);
        });
    },
    setFloatArrayValue: function(name, index, value) {
        _ckDefer(function() {
            _module.ccall('ck_set_float_array_value', 'number',
                ['string', 'number', 'number'], [name, index, value]);
        });
    },
    setAssocFloatArrayValue: function(name, key, value) {
        _ckDefer(function() {
            _module.ccall('ck_set_assoc_float_array_value', 'number',
                ['string', 'string', 'number'], [name, key, value]);
        });
    },
    getFloatArray: function(name) {
        return _ckDeferPromise(function() {
            return new Promise(function(resolve) {
                var id = _ckNextId++;
                _moduleConfig._ckCallbacks[id] = resolve;
                _module.ccall('ck_get_float_array', 'number',
                    ['string', 'number'], [name, id]);
            });
        });
    },
    getFloatArrayValue: function(name, index) {
        return _ckDeferPromise(function() {
            return new Promise(function(resolve) {
                var id = _ckNextId++;
                _moduleConfig._ckCallbacks[id] = resolve;
                _module.ccall('ck_get_float_array_value', 'number',
                    ['string', 'number', 'number'], [name, index, id]);
            });
        });
    },
    getAssocFloatArrayValue: function(name, key) {
        return _ckDeferPromise(function() {
            return new Promise(function(resolve) {
                var id = _ckNextId++;
                _moduleConfig._ckCallbacks[id] = resolve;
                _module.ccall('ck_get_assoc_float_array_value', 'number',
                    ['string', 'string', 'number'], [name, key, id]);
            });
        });
    },

    // ── Persistent Storage (IndexedDB) ──────────────────────────────────

    save: function(key, value) {
        return _getDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                var tx = db.transaction('kv', 'readwrite');
                var req = tx.objectStore('kv').put(value, key);
                req.onsuccess = function() { resolve(); };
                req.onerror = function() { reject(req.error); };
            });
        });
    },

    load: function(key) {
        return _getDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                var tx = db.transaction('kv', 'readonly');
                var req = tx.objectStore('kv').get(key);
                req.onsuccess = function() { resolve(req.result); };
                req.onerror = function() { reject(req.error); };
            });
        });
    },

    delete: function(key) {
        return _getDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                var tx = db.transaction('kv', 'readwrite');
                var req = tx.objectStore('kv').delete(key);
                req.onsuccess = function() { resolve(); };
                req.onerror = function() { reject(req.error); };
            });
        });
    },

    listKeys: function() {
        return _getDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                var tx = db.transaction('kv', 'readonly');
                var req = tx.objectStore('kv').getAllKeys();
                req.onsuccess = function() { resolve(req.result); };
                req.onerror = function() { reject(req.error); };
            });
        });
    },

    // ── Dynamic Audio Import ────────────────────────────────────────────

    loadAudio: function(url, vfsPath) {
        if (vfsPath[0] !== '/') vfsPath = '/' + vfsPath;
        return fetch(url, { mode: 'cors' })
            .catch(function() {
                throw new Error('Failed to fetch (CORS blocked or network error): ' + url);
            })
            .then(function(response) {
                if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + url);
                return response.arrayBuffer();
            })
            .then(function(arrayBuffer) {
                var audioCtx = new OfflineAudioContext(1, 1, 48000);
                return audioCtx.decodeAudioData(arrayBuffer);
            })
            .then(function(audioBuffer) {
                var wavData = _audioBufferToWav(audioBuffer);
                _ensureVfsDir(vfsPath);
                _module.FS.writeFile(vfsPath, new Uint8Array(wavData));
                console.log('[WebChuGL] Audio loaded: ' + vfsPath +
                    ' (' + audioBuffer.duration.toFixed(2) + 's, ' +
                    audioBuffer.numberOfChannels + 'ch)');
                return vfsPath;
            });
    }
};

// ============================================================================
// Persistent Storage (IndexedDB) — lazy-initialized
// ============================================================================

var _ckDBReady = null;

function _getDB() {
    if (_ckDBReady) return _ckDBReady;
    _ckDBReady = new Promise(function(resolve, reject) {
        var request = indexedDB.open('WebChuGL', 1);
        request.onupgradeneeded = function(event) {
            var db = event.target.result;
            if (!db.objectStoreNames.contains('kv')) {
                db.createObjectStore('kv');
            }
        };
        request.onsuccess = function(event) { resolve(event.target.result); };
        request.onerror = function(event) {
            console.error('[WebChuGL] IndexedDB error:', event.target.error);
            reject(event.target.error);
        };
    });
    return _ckDBReady;
}

// ============================================================================
// Dynamic Audio Import — WAV encoder helpers
// ============================================================================

function _writeString(view, offset, string) {
    for (var i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

function _ensureVfsDir(path) {
    var parts = path.split('/').slice(0, -1);
    var current = '';
    for (var i = 0; i < parts.length; i++) {
        if (!parts[i]) continue;
        current += '/' + parts[i];
        try { _module.FS.mkdir(current); } catch(e) {}
    }
}

function _audioBufferToWav(audioBuffer) {
    var numChannels = audioBuffer.numberOfChannels;
    var sampleRate = audioBuffer.sampleRate;
    var numSamples = audioBuffer.length;
    var blockAlign = numChannels * 2;
    var dataSize = numSamples * blockAlign;
    var buffer = new ArrayBuffer(44 + dataSize);
    var view = new DataView(buffer);

    _writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    _writeString(view, 8, 'WAVE');
    _writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    _writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    var channels = [];
    for (var ch = 0; ch < numChannels; ch++) {
        channels.push(audioBuffer.getChannelData(ch));
    }

    var offset = 44;
    for (var i = 0; i < numSamples; i++) {
        for (var ch = 0; ch < numChannels; ch++) {
            var sample = Math.max(-1, Math.min(1, channels[ch][i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            offset += 2;
        }
    }

    return buffer;
}

// ============================================================================
// Device Sensors (Accelerometer + Gyroscope)
// ============================================================================

function _initSensors() {
    var accelPending = null;
    var gyroPending = null;

    // Gamepad/joystick input is now handled natively by emscripten-glfw's
    // built-in joystick support (polled via glfwPollEvents in the render loop).

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

    // Accelerometer
    if (window.DeviceMotionEvent) {
        var handleMotion = function(e) {
            var a = e.accelerationIncludingGravity;
            if (!a) return;
            accelPending = { x: a.x || 0, y: a.y || 0, z: a.z || 0 };
        };

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

    // Gyroscope
    if (window.DeviceOrientationEvent) {
        var handleOrientation = function(e) {
            gyroPending = { alpha: e.alpha || 0, beta: e.beta || 0, gamma: e.gamma || 0 };
        };

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

    ctx.audioWorklet.addModule('webchugl/audio-worklet-processor.js').then(function() {
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

        // Expose audio context and node so setup.js / Web-ChuGins can
        // tap into the audio graph (e.g. for recording, analysis, effects).
        window.audioCtx = ctx;
        window.audioNode = node;

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

        // Resume AudioContext on user interaction
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
