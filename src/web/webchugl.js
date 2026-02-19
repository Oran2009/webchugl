// WebChuGL Runtime
// Call _initWebChuGL(config) to initialize. Returns Promise<CK> bridge object.

// ============================================================================
// Globals (set during initialization)
// ============================================================================

var _module = null;

// ============================================================================
// Utility helpers (pure functions, no side effects)
// ============================================================================

var _binaryExts = /\.(wasm|wav|mp3|ogg|flac|aiff|aif|png|jpg|jpeg|gif|bmp|webp|tga|hdr|obj|mtl|glb|gltf|bin|dat|zip)$/i;

function _isBinaryFile(path) {
    return _binaryExts.test(path);
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

function _writeString(view, offset, string) {
    for (var i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
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
// Device Sensors (Accelerometer + Gyroscope)
// ============================================================================

function _initSensors(ck) {
    var accelPending = null;
    var gyroPending = null;

    // Gamepad/joystick input is now handled natively by emscripten-glfw's
    // built-in joystick support (polled via glfwPollEvents in the render loop).

    function flushSensors() {
        if (!_module) return; // guard: stop if WASM torn down (do NOT re-schedule)
        if (accelPending) {
            ck.setFloat('_accelX', accelPending.x);
            ck.setFloat('_accelY', accelPending.y);
            ck.setFloat('_accelZ', accelPending.z);
            ck.broadcastEvent('_accelReading');
            accelPending = null;
        }
        if (gyroPending) {
            ck.setFloat('_gyroX', gyroPending.alpha);
            ck.setFloat('_gyroY', gyroPending.beta);
            ck.setFloat('_gyroZ', gyroPending.gamma);
            ck.broadcastEvent('_gyroReading');
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
// Service Worker Registration (COOP/COEP headers + offline caching)
// ============================================================================

// Returns true if a page reload was triggered (caller should abort init).
function _registerServiceWorker(swUrl) {
    if (!('serviceWorker' in navigator)) return false;

    // Already cross-origin isolated — SW is working, nothing to do
    if (window.crossOriginIsolated) {
        sessionStorage.removeItem('webchugl-sw-reload');
        return false;
    }

    if (!window.isSecureContext) {
        console.log('[WebChuGL] Service worker requires a secure context (HTTPS or localhost).');
        return false;
    }

    // Ensure the SW is registered (starts install on first visit,
    // checks for updates otherwise). Fire-and-forget.
    navigator.serviceWorker.register(swUrl).catch(function(err) {
        console.error('[WebChuGL] Service worker registration failed:', err);
    });

    // On force-reload (Ctrl+Shift+R) or first visit, the browser sets
    // navigator.serviceWorker.controller to null — the SW cannot control
    // that navigation request.  A normal location.reload() will go through
    // the (now-registered) SW, which injects COOP/COEP headers.
    if (!navigator.serviceWorker.controller) {
        var key = 'webchugl-sw-reload';
        var count = parseInt(sessionStorage.getItem(key) || '0', 10);
        if (count < 2) {
            sessionStorage.setItem(key, String(count + 1));
            location.reload();
            return true;
        }
        // Gave up after 2 reloads — proceed without isolation.
        // The controllerchange listener below will still reload if
        // the SW activates later (e.g., slow first-visit install).
        console.warn('[WebChuGL] crossOriginIsolated is still false after ' + count + ' reloads. Giving up.');
        sessionStorage.removeItem(key);
    }

    // Reload when a new SW becomes the controller (covers fresh installs
    // that finish after the counter expired, and SW updates).
    navigator.serviceWorker.addEventListener('controllerchange', function() {
        if (!window.crossOriginIsolated) location.reload();
    }, { once: true });

    return false;
}

// ============================================================================
// Main Initialization
// ============================================================================
//
// config = {
//   canvas:           HTMLCanvasElement  (required)
//   baseUrl:          string             (default: 'webchugl/')
//   audioConfig:      { sampleRate, outputChannels, inputChannels }
//   onProgress:       function(pct)      (loading progress 0-100)
//   onError:          function(msg)      (error display)
//   onReady:          function()         (called when init complete)
// }
//
// Returns: Promise<CK>

function _initWebChuGL(config) {
    var _baseUrl = config.baseUrl || 'webchugl/';
    if (_baseUrl[_baseUrl.length - 1] !== '/') _baseUrl += '/';
    var _canvas = config.canvas;
    var _chuginUrls = config.chugins || [];
    var _loadedChugins = {};
    var _onProgress = config.onProgress || function() {};
    var _onError = config.onError || function(msg) { console.error('[WebChuGL] ' + msg); };
    var _onReady = config.onReady || function() {};

    // Lazy-load JSZip (shared across loadZip, runZip, loadPackage)
    var _jszipPromise = null;
    function _ensureJSZip() {
        if (typeof JSZip !== 'undefined') return Promise.resolve();
        if (_jszipPromise) return _jszipPromise;
        _jszipPromise = new Promise(function(resolve, reject) {
            var s = document.createElement('script');
            s.src = _baseUrl + 'jszip.min.js';
            s.onload = resolve;
            s.onerror = function() { reject(new Error('Failed to load jszip')); };
            document.head.appendChild(s);
        });
        return _jszipPromise;
    }

    // Load a .chug.wasm that's already in the VFS. Returns the short name, or null on failure.
    function _loadChuginFromVfs(vfsPath) {
        var filename = vfsPath.split('/').pop();
        var shortName = filename.replace('.chug.wasm', '');
        if (_loadedChugins[shortName]) return shortName;
        var result = _module.ccall('ck_load_chugin', 'number', ['string'], [vfsPath]);
        if (result) {
            _loadedChugins[shortName] = true;
            return shortName;
        }
        return null;
    }

    // ── Service Worker ──────────────────────────────────────────────────
    if (config.serviceWorker !== false) {
        var reloadPending = _registerServiceWorker(config.serviceWorkerUrl || './sw.js');
        if (reloadPending) {
            // Page will reload for cross-origin isolation — don't start WASM init
            return new Promise(function() {});
        }
    }

    // ── Audio Config ────────────────────────────────────────────────────
    // Priority: defaults < URL params < init config.audioConfig
    var _audioConfig = (function() {
        var defaults = { sampleRate: 48000, outChannels: 2, inChannels: 2 };
        var params = new URLSearchParams(window.location.search);
        var sr = parseInt(params.get('srate'), 10);
        var out = parseInt(params.get('out'), 10);
        var inp = parseInt(params.get('in'), 10);
        if (sr > 0) defaults.sampleRate = sr;
        if (out > 0) defaults.outChannels = out;
        if (inp > 0) defaults.inChannels = inp;
        var ac = config.audioConfig;
        if (ac) {
            if (ac.sampleRate > 0) defaults.sampleRate = ac.sampleRate;
            if (ac.outputChannels > 0) defaults.outChannels = ac.outputChannels;
            if (ac.inputChannels > 0) defaults.inChannels = ac.inputChannels;
        }
        return defaults;
    })();

    // ── Audio state (closure-scoped) ────────────────────────────────────
    var _audioCtx = null;
    var _audioNode = null;

    // ── Module Config ───────────────────────────────────────────────────
    var _moduleConfig = {
        noInitialRun: true,

        _audioConfig: _audioConfig,

        canvas: (function() {
            _canvas.addEventListener('webglcontextlost', function(e) {
                e.preventDefault();
            }, false);
            return _canvas;
        })(),

        locateFile: function(path) {
            if (path === 'index.wasm') path = 'webchugl.wasm';
            return _baseUrl + path;
        },

        print: function(text) {
            console.log(text);
        },

        printErr: function(text) {
            console.error(text);
        },

        setStatus: function() {},

        _ckCallbacks: {},
        _ckEventListeners: {},

        // Called from C++ initAudio() via EM_ASM
        _initAudio: function(sab, outBufPtr, outWritePosPtr, outReadPosPtr,
                             inBufPtr, inWritePosPtr, inReadPosPtr,
                             capacity, needsMic, sampleRate, outChannels, inChannels) {
            var ctx;
            try {
                ctx = new AudioContext({ sampleRate: sampleRate, latencyHint: 'interactive' });
            } catch (e) {
                console.error('[WebChuGL] Failed to create AudioContext: ' + e.message);
                return;
            }

            ctx.audioWorklet.addModule(_baseUrl + 'audio-worklet-processor.js').then(function() {
                var node = new AudioWorkletNode(ctx, 'chuck-processor', {
                    numberOfInputs: 1,
                    numberOfOutputs: 1,
                    outputChannelCount: [outChannels],
                    channelCount: inChannels,
                    channelCountMode: 'explicit'
                });

                node.port.postMessage({
                    sab: sab,
                    outBufOffset: outBufPtr,
                    outWritePosOffset: outWritePosPtr,
                    outReadPosOffset: outReadPosPtr,
                    inBufOffset: inBufPtr,
                    inWritePosOffset: inWritePosPtr,
                    inReadPosOffset: inReadPosPtr,
                    capacity: capacity,
                    outChannels: outChannels,
                    inChannels: inChannels
                });

                node.connect(ctx.destination);

                _audioCtx = ctx;
                _audioNode = node;

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
                function removeStartAudio() {
                    document.removeEventListener('click', startAudio);
                    document.removeEventListener('keydown', startAudio);
                    document.removeEventListener('touchstart', startAudio);
                }
                var startAudio = function() {
                    if (ctx.state === 'running') {
                        removeStartAudio();
                        return;
                    }
                    ctx.resume().then(removeStartAudio).catch(function(err) {
                        console.warn('[WebChuGL] AudioContext resume failed:', err);
                        removeStartAudio();
                    });
                };
                document.addEventListener('click', startAudio);
                document.addEventListener('keydown', startAudio);
                document.addEventListener('touchstart', startAudio);

                console.log('[WebChuGL] Audio initialized (JS AudioWorklet)');
            }).catch(function(err) {
                console.error('[WebChuGL] Audio worklet failed: ' + err.message);
            });
        },

        preRun: [function(mod) {
            _module = mod;
            _ensureVfsDir('/code');
            _onProgress(100);
        }]
    };

    // ── CK Bridge ───────────────────────────────────────────────────────
    var _ckNextId = 1;
    var _ckReady = false;
    var _ckQueue = [];
    function _ckDefer(fn) {
        if (_ckReady) fn();
        else _ckQueue.push(fn);
    }

    function _ckDeferPromise(fn) {
        if (_ckReady) {
            try { return fn(); }
            catch (e) { return Promise.reject(e); }
        }
        return new Promise(function(resolve, reject) {
            _ckQueue.push(function() {
                try { fn().then(resolve, reject); }
                catch (e) { reject(e); }
            });
        });
    }

    function _ckFlush() {
        _ckReady = true;
        for (var i = 0; i < _ckQueue.length; i++) _ckQueue[i]();
        _ckQueue = [];
    }

    // Settle all pending _ckGet callbacks (e.g., on VM reset or teardown).
    // Resolves with undefined so hanging promises settle rather than leak.
    function _ckFlushCallbacks() {
        var cbs = _moduleConfig._ckCallbacks;
        var keys = Object.keys(cbs);
        for (var i = 0; i < keys.length; i++) {
            cbs[keys[i]](undefined);
            delete cbs[keys[i]];
        }
    }

    function _ckSet(func, types, args) {
        _ckDefer(function() {
            _module.ccall(func, 'number', types, args);
        });
    }

    function _ckGet(func, types, args) {
        return _ckDeferPromise(function() {
            return new Promise(function(resolve, reject) {
                var id = _ckNextId++;
                _moduleConfig._ckCallbacks[id] = resolve;
                var ret = _module.ccall(func, 'number', types.concat('number'), args.concat(id));
                if (!ret) {
                    delete _moduleConfig._ckCallbacks[id];
                    reject(new Error(func + ' failed'));
                }
            });
        });
    }

    var CK = {

        // ── Audio access (null until audio system initializes) ────────
        get audioContext() { return _audioCtx; },
        get audioNode() { return _audioNode; },

        getSampleRate: function() {
            return _audioCtx ? _audioCtx.sampleRate : null;
        },

        // ── VM Introspection ────────────────────────────────────────────

        getCurrentTime: function() {
            if (!_module) return 0;
            return _module.ccall('ck_get_now', 'number', [], []);
        },

        getActiveShreds: function() {
            if (!_module) return [];
            var json = _module.ccall('ck_get_active_shreds', 'string', [], []);
            try { return JSON.parse(json); } catch(e) { return []; }
        },

        getLastError: function() {
            if (!_module) return '';
            return _module.ccall('ck_get_last_compile_output', 'string', [], []);
        },

        getGlobalVariables: function() {
            if (!_module) return [];
            var json = _module.ccall('ck_get_all_globals', 'string', [], []);
            try { return JSON.parse(json); } catch(e) { return []; }
        },

        // ── Code execution ─────────────────────────────────────────────

        runCode: function(code) {
            return _ckDeferPromise(function() {
                return Promise.resolve(
                    _module.ccall('ck_run_code', 'number', ['string'], [code])
                );
            });
        },

        runFile: function(pathOrUrl) {
            if (pathOrUrl[0] === '/') {
                // VFS path — run directly
                return _ckDeferPromise(function() {
                    return Promise.resolve(
                        _module.ccall('ck_run_file', 'number', ['string'], [pathOrUrl])
                    );
                });
            }
            // Check if already in VFS at /code/<name> before fetching
            var parts = pathOrUrl.split('/');
            var filename = parts[parts.length - 1];
            var vfsCheck = '/code/' + filename;
            try {
                _module.FS.stat(vfsCheck);
                // File exists in VFS — run directly
                return _ckDeferPromise(function() {
                    return Promise.resolve(
                        _module.ccall('ck_run_file', 'number', ['string'], [vfsCheck])
                    );
                });
            } catch (e) {
                // Not in VFS — fetch as URL, then run
                return CK.loadFile(pathOrUrl).then(function(vfsPath) {
                    return _ckDeferPromise(function() {
                        return Promise.resolve(
                            _module.ccall('ck_run_file', 'number', ['string'], [vfsPath])
                        );
                    });
                });
            }
        },

        createFile: function(path, data) {
            _ckDefer(function() {
                _ensureVfsDir(path);
                if (typeof data === 'string') {
                    _module.FS.writeFile(path, data);
                } else {
                    _module.FS.writeFile(path, new Uint8Array(data));
                }
            });
        },

        removeFile: function(path) {
            try {
                var stat = _module.FS.stat(path);
                if (_module.FS.isDir(stat.mode)) {
                    // Recursive directory removal
                    var entries = _module.FS.readdir(path).filter(function(e) { return e !== '.' && e !== '..'; });
                    for (var i = 0; i < entries.length; i++) {
                        CK.removeFile(path + '/' + entries[i]);
                    }
                    _module.FS.rmdir(path);
                } else {
                    _module.FS.unlink(path);
                }
                return true;
            } catch (e) {
                return false;
            }
        },

        fileExists: function(path) {
            try {
                _module.FS.stat(path);
                return true;
            } catch (e) {
                return false;
            }
        },

        listFiles: function(dir) {
            dir = dir || '/code';
            function walk(d) {
                var results = [];
                try {
                    var entries = _module.FS.readdir(d);
                } catch (e) {
                    return results;
                }
                for (var i = 0; i < entries.length; i++) {
                    if (entries[i] === '.' || entries[i] === '..') continue;
                    var full = d + '/' + entries[i];
                    var stat = _module.FS.stat(full);
                    if (_module.FS.isDir(stat.mode)) {
                        results = results.concat(walk(full));
                    } else {
                        results.push(full);
                    }
                }
                return results;
            }
            return walk(dir);
        },

        loadFile: function(url, vfsPath) {
            if (!vfsPath) {
                var parts = url.split('/');
                vfsPath = '/code/' + parts[parts.length - 1];
            }
            if (vfsPath[0] !== '/') vfsPath = '/' + vfsPath;
            var isBinary = _isBinaryFile(vfsPath);
            var isChugin = vfsPath.endsWith('.chug.wasm');
            return fetch(url)
                .then(function(response) {
                    if (!response.ok) throw new Error('Failed to fetch ' + url);
                    return isBinary ? response.arrayBuffer() : response.text();
                })
                .then(function(data) {
                    _ckDefer(function() {
                        _ensureVfsDir(vfsPath);
                        _module.FS.writeFile(vfsPath, isBinary ? new Uint8Array(data) : data);
                        if (isChugin) _loadChuginFromVfs(vfsPath);
                    });
                    return vfsPath;
                });
        },

        loadFiles: function(basePath, files) {
            if (basePath[basePath.length - 1] !== '/') basePath += '/';
            return Promise.all(files.map(function(file) {
                var url = basePath + file;
                var vfsPath = '/code/' + file;
                var isBinary = _isBinaryFile(file);
                var isChugin = file.endsWith('.chug.wasm');
                return fetch(url)
                    .then(function(response) {
                        if (!response.ok) throw new Error('Failed to fetch ' + url);
                        return isBinary ? response.arrayBuffer() : response.text();
                    })
                    .then(function(data) {
                        _ckDefer(function() {
                            _ensureVfsDir(vfsPath);
                            _module.FS.writeFile(vfsPath, isBinary ? new Uint8Array(data) : data);
                            if (isChugin) _loadChuginFromVfs(vfsPath);
                        });
                        return vfsPath;
                    });
            }));
        },

        loadZip: function(url) {
            var jszipReady = _ensureJSZip();
            return fetch(url)
                .then(function(response) {
                    if (!response.ok) throw new Error('Failed to fetch ' + url);
                    return response.arrayBuffer();
                })
                .then(function(zipData) {
                    return jszipReady.then(function() { return JSZip.loadAsync(zipData); });
                })
                .then(function(zip) {
                    var entries = Object.keys(zip.files).filter(function(name) {
                        return !zip.files[name].dir;
                    });
                    return Promise.all(entries.map(function(name) {
                        return zip.files[name].async('arraybuffer').then(function(content) {
                            var vfsPath = '/code/' + name;
                            _ckDefer(function() {
                                _ensureVfsDir(vfsPath);
                                _module.FS.writeFile(vfsPath, new Uint8Array(content));
                                if (name.endsWith('.chug.wasm')) _loadChuginFromVfs(vfsPath);
                            });
                        });
                    }));
                })
                .then(function() {
                    console.log('[WebChuGL] Zip extracted: ' + url);
                });
        },

        runZip: function(url, mainFile) {
            if (mainFile && mainFile[0] !== '/') mainFile = '/code/' + mainFile;
            var jszipReady = _ensureJSZip();
            return fetch(url)
                .then(function(response) {
                    if (!response.ok) throw new Error('Failed to fetch ' + url);
                    return response.arrayBuffer();
                })
                .then(function(zipData) {
                    return jszipReady.then(function() { return JSZip.loadAsync(zipData); });
                })
                .then(function(zip) {
                    var entries = Object.keys(zip.files).filter(function(name) {
                        return !zip.files[name].dir;
                    });
                    // Auto-detect main file: prefer main.ck at root, else first root .ck
                    if (!mainFile) {
                        if (entries.indexOf('main.ck') !== -1) {
                            mainFile = '/code/main.ck';
                        } else {
                            var rootCk = entries.filter(function(n) {
                                return n.endsWith('.ck') && n.indexOf('/') === -1;
                            });
                            mainFile = rootCk.length ? '/code/' + rootCk[0] : '/code/main.ck';
                        }
                    }
                    return Promise.all(entries.map(function(name) {
                        return zip.files[name].async('arraybuffer').then(function(content) {
                            var vfsPath = '/code/' + name;
                            _ckDefer(function() {
                                _ensureVfsDir(vfsPath);
                                _module.FS.writeFile(vfsPath, new Uint8Array(content));
                                if (name.endsWith('.chug.wasm')) _loadChuginFromVfs(vfsPath);
                            });
                        });
                    }));
                })
                .then(function() {
                    return _ckDeferPromise(function() {
                        return Promise.resolve(
                            _module.ccall('ck_run_file', 'number', ['string'], [mainFile])
                        );
                    });
                });
        },

        // ── Scalar setters ─────────────────────────────────────────────

        setInt:    function(name, val) { _ckSet('ck_set_int',    ['string', 'number'], [name, val]); },
        setFloat:  function(name, val) { _ckSet('ck_set_float',  ['string', 'number'], [name, val]); },
        setString: function(name, val) { _ckSet('ck_set_string', ['string', 'string'], [name, val]); },

        // ── Scalar getters (Promise-based) ─────────────────────────────

        getInt:    function(name) { return _ckGet('ck_get_int',    ['string'], [name]); },
        getFloat:  function(name) { return _ckGet('ck_get_float',  ['string'], [name]); },
        getString: function(name) { return _ckGet('ck_get_string', ['string'], [name]); },

        // ── Events ─────────────────────────────────────────────────────

        signalEvent:    function(name) { _ckSet('ck_signal_event',    ['string'], [name]); },
        broadcastEvent: function(name) { _ckSet('ck_broadcast_event', ['string'], [name]); },

        listenForEvent: function(name, callback) {
            var id = _ckNextId++;
            _moduleConfig._ckEventListeners[id] = { callback: callback, once: false };
            _ckSet('ck_listen_event', ['string', 'number', 'number'], [name, id, 1]);
            return id;
        },
        listenForEventOnce: function(name, callback) {
            var id = _ckNextId++;
            _moduleConfig._ckEventListeners[id] = { callback: callback, once: true };
            _ckSet('ck_listen_event', ['string', 'number', 'number'], [name, id, 0]);
            return id;
        },
        stopListeningForEvent: function(name, listenerId) {
            delete _moduleConfig._ckEventListeners[listenerId];
            _ckSet('ck_stop_listening_event', ['string', 'number'], [name, listenerId]);
        },
        // Alias for WebChucK API compatibility
        startListeningForEvent: function(name, callback) {
            return this.listenForEvent(name, callback);
        },

        // ── Int array operations ───────────────────────────────────────

        setIntArray: function(name, jsArray) {
            _ckDefer(function() {
                var buf = new Uint8Array(new Int32Array(jsArray).buffer);
                _module.ccall('ck_set_int_array', 'number',
                    ['string', 'array', 'number'], [name, buf, jsArray.length]);
            });
        },
        setIntArrayValue:      function(name, index, value) { _ckSet('ck_set_int_array_value',       ['string', 'number', 'number'], [name, index, value]); },
        setAssocIntArrayValue: function(name, key, value)   { _ckSet('ck_set_assoc_int_array_value', ['string', 'string', 'number'], [name, key, value]); },
        getIntArray:           function(name)               { return _ckGet('ck_get_int_array',             ['string'],                   [name]); },
        getIntArrayValue:      function(name, index)        { return _ckGet('ck_get_int_array_value',       ['string', 'number'],         [name, index]); },
        getAssocIntArrayValue: function(name, key)          { return _ckGet('ck_get_assoc_int_array_value', ['string', 'string'],         [name, key]); },

        // ── Float array operations ─────────────────────────────────────

        setFloatArray: function(name, jsArray) {
            _ckDefer(function() {
                var buf = new Uint8Array(new Float64Array(jsArray).buffer);
                _module.ccall('ck_set_float_array', 'number',
                    ['string', 'array', 'number'], [name, buf, jsArray.length]);
            });
        },
        setFloatArrayValue:      function(name, index, value) { _ckSet('ck_set_float_array_value',       ['string', 'number', 'number'], [name, index, value]); },
        setAssocFloatArrayValue: function(name, key, value)   { _ckSet('ck_set_assoc_float_array_value', ['string', 'string', 'number'], [name, key, value]); },
        getFloatArray:           function(name)               { return _ckGet('ck_get_float_array',             ['string'],                   [name]); },
        getFloatArrayValue:      function(name, index)        { return _ckGet('ck_get_float_array_value',       ['string', 'number'],         [name, index]); },
        getAssocFloatArrayValue: function(name, key)          { return _ckGet('ck_get_assoc_float_array_value', ['string', 'string'],         [name, key]); },

        // ── Persistent Storage (IndexedDB) ─────────────────────────────

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

        // ── MIDI ──────────────────────────────────────────────────────

        initMidi: function(access) {
            window._rtmidi_internals_midi_access = access;
            window._rtmidi_internals_latest_message_timestamp = 0.0;
            window._rtmidi_internals_waiting = false;
            window._rtmidi_internals_get_port_by_number = function(portNumber, isInput) {
                var midi = window._rtmidi_internals_midi_access;
                var devices = isInput ? midi.inputs : midi.outputs;
                var i = 0;
                for (var device of devices.values()) {
                    if (i === portNumber) return device;
                    i++;
                }
                return null;
            };
        },

        // ── Dynamic Audio Import ───────────────────────────────────────

        loadAudio: function(url, vfsPath) {
            if (!vfsPath) {
                var parts = url.split('/');
                var name = parts[parts.length - 1].split('?')[0];
                vfsPath = '/audio/' + (name || 'audio.wav');
            }
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
                    var ctx = _audioCtx || new OfflineAudioContext(1, 1, 48000);
                    return ctx.decodeAudioData(arrayBuffer);
                })
                .then(function(audioBuffer) {
                    var wavData = _audioBufferToWav(audioBuffer);
                    _ckDefer(function() {
                        _ensureVfsDir(vfsPath);
                        _module.FS.writeFile(vfsPath, new Uint8Array(wavData));
                    });
                    console.log('[WebChuGL] Audio loaded: ' + vfsPath +
                        ' (' + audioBuffer.duration.toFixed(2) + 's, ' +
                        audioBuffer.numberOfChannels + 'ch)');
                    return vfsPath;
                });
        },

        // ── ChuGin Loading ────────────────────────────────────────────

        loadChugin: function(url) {
            var name = url.split('/').pop();
            var shortName = name.replace('.chug.wasm', '');
            if (_loadedChugins[shortName]) return Promise.resolve(shortName);
            return fetch(url).then(function(r) {
                if (!r.ok) throw new Error('Failed to fetch chugin: ' + url);
                return r.arrayBuffer();
            }).then(function(buf) {
                return _ckDeferPromise(function() {
                    var vfsPath = '/chugins/' + name;
                    _ensureVfsDir(vfsPath);
                    _module.FS.writeFile(vfsPath, new Uint8Array(buf));
                    var loaded = _loadChuginFromVfs(vfsPath);
                    if (!loaded) return Promise.reject(new Error('Failed to load chugin: ' + name));
                    return Promise.resolve(loaded);
                });
            });
        },

        getLoadedChugins: function() {
            return Object.keys(_loadedChugins);
        },

        // ── ChuMP Package Loading ─────────────────────────────────────

        loadPackage: function(name, version, url) {
            if (!name || !/^[a-zA-Z0-9_@\/-]+$/.test(name)) {
                return Promise.reject(new Error('Invalid package name: ' + name));
            }
            version = version || 'latest';
            if (!/^[a-zA-Z0-9._-]+$/.test(version)) {
                return Promise.reject(new Error('Invalid package version: ' + version));
            }

            var jszipReady = _ensureJSZip();

            // Resolve zip URL from ChuMP registry if not provided
            var zipPromise;
            if (url) {
                zipPromise = fetch(url).then(function(r) {
                    if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + url);
                    return r.arrayBuffer();
                });
            } else {
                var manifestUrl = 'https://raw.githubusercontent.com/ccrma/chump-packages/main/packages/'
                    + name + '/' + version + '/' + name + '.json';
                zipPromise = fetch(manifestUrl).then(function(r) {
                    if (!r.ok) throw new Error('Package not found: ' + name + '@' + version);
                    return r.json();
                }).then(function(manifest) {
                    var files = manifest.files || [];
                    if (!files.length || !files[0].url) {
                        throw new Error('No download URL in manifest for ' + name);
                    }
                    return fetch(files[0].url).then(function(r) {
                        if (!r.ok) throw new Error('HTTP ' + r.status);
                        return r.arrayBuffer();
                    });
                });
            }

            return Promise.all([jszipReady, zipPromise]).then(function(results) {
                return JSZip.loadAsync(results[1]);
            }).then(function(zip) {
                var stripDirs = ['examples', '_examples', 'scripts', 'releases', '.git'];
                var stripFiles = ['readme', 'versions', 'imgui.ini'];
                var entries = Object.keys(zip.files).filter(function(n) {
                    if (zip.files[n].dir) return false;
                    var firstDir = n.split('/')[0].toLowerCase();
                    if (stripDirs.indexOf(firstDir) >= 0) return false;
                    var basename = n.split('/').pop().toLowerCase();
                    if (stripFiles.indexOf(basename) >= 0) return false;
                    return true;
                });
                return Promise.all(entries.map(function(entryName) {
                    return zip.files[entryName].async('arraybuffer').then(function(content) {
                        _ckDefer(function() {
                            var vfsPath = '/packages/' + name + '/' + entryName;
                            _ensureVfsDir(vfsPath);
                            _module.FS.writeFile(vfsPath, new Uint8Array(content));
                        });
                    });
                }));
            }).then(function() {
                console.log('[WebChuGL] Package loaded: ' + name + '@' + version);
                return name;
            });
        }
    };

    // ── Launch ──────────────────────────────────────────────────────────
    return createWebChuGL(_moduleConfig).then(function(mod) {
        _module = mod;

        if (!navigator.gpu) {
            _onError('WebGPU is not available');
            return CK;
        }

        // Fetch chugins in parallel with WebGPU adapter/device acquisition.
        // VFS writes are deferred until preRun has fired (module FS is ready).
        var _pendingChuginBuffers = [];
        var chuginPromise = _chuginUrls.length > 0
            ? Promise.all(_chuginUrls.map(function(url) {
                return fetch(url).then(function(r) {
                    if (!r.ok) throw new Error('Failed to fetch chugin: ' + url);
                    return r.arrayBuffer();
                }).then(function(buf) {
                    var name = url.split('/').pop();
                    _pendingChuginBuffers.push({ name: name, buf: buf });
                    console.log('[WebChuGL] Fetched chugin: ' + name);
                });
            }))
            : Promise.resolve();

        var gpuPromise = navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });

        return Promise.all([chuginPromise, gpuPromise]).then(function(results) {
            var adapter = results[1];
            if (!adapter) {
                _onError('Failed to get WebGPU adapter');
                return CK;
            }
            return adapter.requestDevice().then(function(device) {
                _module._preAdapter = adapter;
                _module._preDevice = device;
                _onReady();
                _module.callMain([]);

                // Write fetched chugins to VFS and load (after callMain so the_chuck exists)
                for (var i = 0; i < _pendingChuginBuffers.length; i++) {
                    var entry = _pendingChuginBuffers[i];
                    var vfsPath = '/chugins/' + entry.name;
                    _ensureVfsDir(vfsPath);
                    _module.FS.writeFile(vfsPath, new Uint8Array(entry.buf));
                    var loaded = _loadChuginFromVfs(vfsPath);
                    if (!loaded) {
                        console.warn('[WebChuGL] Failed to load chugin: ' + vfsPath);
                    }
                }

                _initSensors(CK);
                _ckFlush();
                return CK;
            });
        }).catch(function(e) {
            console.error('WebGPU pre-init failed:', e);
            _onError('WebGPU init failed: ' + e.message);
            _ckFlushCallbacks();
            return CK;
        });
    });
}
