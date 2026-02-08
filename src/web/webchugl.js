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
            var binaryExts = ['png', 'jpg', 'jpeg', 'gif', 'wav', 'mp3', 'ogg', 'ttf', 'otf', 'woff', 'woff2', 'bin', 'dat', 'wasm'];
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
                var total = files.length;
                var loaded = 0;
                Module.setStatus('Loading 0/' + total + ' files...');

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
                            loaded++;
                            Module.setStatus('Loading ' + loaded + '/' + total + ' files...');
                        });
                }));
            })
            .then(function() {
                // Scan for ChuGins in the code directory only (recursive)
                ChuginLoader.scanForChugins('/code');
                if (ChuginLoader.pendingChugins.length > 0) {
                    console.log('[WebChuGL] Found ' + ChuginLoader.pendingChugins.length + ' ChuGin(s)');
                }
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
// ChuGin Loader
// Loads .chug.wasm files (SIDE_MODULEs) and registers them with ChucK
//
// ChuGins must be compiled as Emscripten SIDE_MODULEs:
//   emcc chugin.cpp -sSIDE_MODULE=2 -sEXPORTED_FUNCTIONS=['_ck_query'] -o MyChugin.chug.wasm
// ============================================================================

var ChuginLoader = {
    loadedChugins: [],
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

    // Load a .chug.wasm SIDE_MODULE and return function table index for ck_query
    loadChugin: function(fsPath) {
        console.log('[ChuginLoader] Loading: ' + fsPath);

        try {
            var wasmBytes = FS.readFile(fsPath);

            // Allocate memory region for this ChuGin's static data
            var memoryBase = Module._malloc(65536);
            if (!memoryBase) {
                console.error('[ChuginLoader] Failed to allocate memory');
                return -1;
            }

            // Allocate table slots for ChuGin's functions
            var tableBase = Module.wasmTable.length;
            Module.wasmTable.grow(100);

            // Build reverse lookup: wasm function -> table index
            var funcToTableIdx = new Map();
            for (var ti = 1; ti < Module.wasmTable.length; ti++) {
                try {
                    var f = Module.wasmTable.get(ti);
                    if (f) funcToTableIdx.set(f, ti);
                } catch(e) {}
            }
            var nextFreeTableSlot = tableBase;

            // GOT entries - created as mutable globals during instantiation,
            // then patched from ChuGin's own exports before __wasm_apply_data_relocs
            var GOTFunc = {};
            var unresolvedGOTFunc = [];
            var createGOTFuncProxy = function() {
                return new Proxy({}, {
                    get: function(obj, name) {
                        if (!GOTFunc[name]) {
                            var idx = 0;
                            // Try main module exports first
                            var func = (typeof wasmExports !== 'undefined') ? wasmExports[name] : null;
                            if (func && typeof func === 'function') {
                                idx = funcToTableIdx.get(func);
                                if (idx === undefined) {
                                    idx = nextFreeTableSlot++;
                                    try {
                                        Module.wasmTable.set(idx, func);
                                        funcToTableIdx.set(func, idx);
                                    } catch(e) { idx = 0; }
                                }
                            } else {
                                // Will try to resolve from ChuGin's own exports after instantiation
                                unresolvedGOTFunc.push(name);
                            }
                            GOTFunc[name] = new WebAssembly.Global(
                                {value: 'i32', mutable: true}, idx
                            );
                        }
                        return GOTFunc[name];
                    }
                });
            };

            var GOTMem = {};
            var unresolvedGOTMem = [];
            var createGOTMemProxy = function() {
                return new Proxy({}, {
                    get: function(obj, name) {
                        if (!GOTMem[name]) {
                            var addr = 0;
                            if (typeof wasmExports !== 'undefined' && wasmExports[name]) {
                                var exp = wasmExports[name];
                                if (exp instanceof WebAssembly.Global) {
                                    addr = exp.value;
                                } else if (typeof exp === 'number') {
                                    addr = exp;
                                }
                            } else {
                                // Will try to resolve from ChuGin's own exports after instantiation
                                unresolvedGOTMem.push(name);
                            }
                            GOTMem[name] = new WebAssembly.Global(
                                {value: 'i32', mutable: true}, addr
                            );
                        }
                        return GOTMem[name];
                    }
                });
            };

            // Get stack pointer from main module
            var stackPointer;
            try {
                stackPointer = (typeof wasmExports !== 'undefined' && wasmExports.__stack_pointer)
                    ? wasmExports.__stack_pointer
                    : new WebAssembly.Global({value: 'i32', mutable: true}, memoryBase + 65536 - 256);
            } catch (e) {
                stackPointer = new WebAssembly.Global({value: 'i32', mutable: true}, memoryBase + 65536 - 256);
            }

            // Create env imports using a Proxy to auto-forward to main module exports
            var envBase = {
                'memory': Module.wasmMemory,
                '__indirect_function_table': Module.wasmTable,
                '__stack_pointer': stackPointer,
                '__memory_base': new WebAssembly.Global({value: 'i32', mutable: false}, memoryBase),
                '__table_base': new WebAssembly.Global({value: 'i32', mutable: false}, tableBase)
            };

            // Common fallbacks for functions not exported by main module
            var fallbacks = {
                // C++ new/delete -> malloc/free
                '_Znwm': function(size) { return Module._malloc(size); },
                '_Znwj': function(size) { return Module._malloc(size); },
                '_ZdlPv': function(ptr) { Module._free(ptr); },
                '_ZdlPvm': function(ptr) { Module._free(ptr); },
                // Exception handling
                '__cxa_find_matching_catch_2': function() { return 0; },
                '__cxa_find_matching_catch_3': function() { return 0; },
                'getTempRet0': function() { return 0; },
                'setTempRet0': function() { },
                '__resumeException': function(ptr) { throw ptr; },
                // Threading
                'pthread_self': function() { return 0; },
                'emscripten_builtin_memalign': function(align, size) { return Module._malloc(size); },
                // Math functions
                'pow': Math.pow, 'powf': Math.pow,
                'sin': Math.sin, 'sinf': Math.sin,
                'cos': Math.cos, 'cosf': Math.cos,
                'tan': Math.tan, 'tanf': Math.tan,
                'sqrt': Math.sqrt, 'sqrtf': Math.sqrt,
                'exp': Math.exp, 'expf': Math.exp,
                'log': Math.log, 'logf': Math.log,
                'log2': Math.log2, 'log2f': Math.log2,
                'log10': Math.log10, 'log10f': Math.log10,
                'fabs': Math.abs, 'fabsf': Math.abs,
                'floor': Math.floor, 'floorf': Math.floor,
                'ceil': Math.ceil, 'ceilf': Math.ceil,
                'round': Math.round, 'roundf': Math.round,
                'trunc': Math.trunc, 'truncf': Math.trunc,
                'atan': Math.atan, 'atanf': Math.atan,
                'atan2': Math.atan2, 'atan2f': Math.atan2,
                'asin': Math.asin, 'asinf': Math.asin,
                'acos': Math.acos, 'acosf': Math.acos,
                'sinh': Math.sinh, 'sinhf': Math.sinh,
                'cosh': Math.cosh, 'coshf': Math.cosh,
                'tanh': Math.tanh, 'tanhf': Math.tanh,
                'fmin': Math.min, 'fminf': Math.min,
                'fmax': Math.max, 'fmaxf': Math.max,
                'fmod': function(x, y) { return x % y; },
                'fmodf': function(x, y) { return x % y; },
                'exp2': function(x) { return Math.pow(2, x); },
                'exp2f': function(x) { return Math.pow(2, x); },
                'ldexp': function(x, e) { return x * Math.pow(2, e); },
                'ldexpf': function(x, e) { return x * Math.pow(2, e); },
                'copysign': function(x, y) { return Math.sign(y) * Math.abs(x); },
                'copysignf': function(x, y) { return Math.sign(y) * Math.abs(x); },
                // Runtime
                'abort': function() { throw new Error('abort'); }
            };

            var envProxy = new Proxy(envBase, {
                get: function(target, name) {
                    if (name in target) return target[name];

                    // Try main module's exports
                    if (typeof wasmExports !== 'undefined' && wasmExports[name]) {
                        return wasmExports[name];
                    }
                    if (Module['_' + name]) return Module['_' + name];

                    // Check fallbacks
                    if (name in fallbacks) return fallbacks[name];

                    // Generate invoke_* wrappers for exception handling
                    if (name.startsWith('invoke_')) {
                        return function(index) {
                            var args = Array.prototype.slice.call(arguments, 1);
                            try { return Module.wasmTable.get(index).apply(null, args); }
                            catch (e) { return 0; }
                        };
                    }

                    console.warn('[ChuginLoader] Missing import: env.' + name);
                    return function() { return 0; };
                },
                has: function() { return true; }
            });

            // Instantiate the SIDE_MODULE
            var module = new WebAssembly.Module(wasmBytes);
            var instance = new WebAssembly.Instance(module, {
                'env': envProxy,
                'GOT.mem': createGOTMemProxy(),
                'GOT.func': createGOTFuncProxy()
            });

            // Debug: log all ChuGin exports
            console.log('[ChuginLoader] Exports:', Object.keys(instance.exports));
            console.log('[ChuginLoader] Unresolved GOT.func:', unresolvedGOTFunc);
            console.log('[ChuginLoader] Unresolved GOT.mem:', unresolvedGOTMem);

            // Resolve GOT.func entries from ChuGin's own exports
            // We add each function to a new table slot rather than searching
            // (table search fails because JS wrapper objects differ even for same WASM func)
            for (var ui = 0; ui < unresolvedGOTFunc.length; ui++) {
                var symName = unresolvedGOTFunc[ui];
                var exportedFunc = instance.exports[symName] || instance.exports['_' + symName];
                if (exportedFunc && typeof exportedFunc === 'function') {
                    var idx = nextFreeTableSlot++;
                    Module.wasmTable.set(idx, exportedFunc);
                    GOTFunc[symName].value = idx;
                } else {
                    console.warn('[ChuginLoader] GOT.func: ChuGin does not export ' + symName);
                }
            }

            // Resolve GOT.mem entries from ChuGin's own exports
            for (var mi = 0; mi < unresolvedGOTMem.length; mi++) {
                var memName = unresolvedGOTMem[mi];
                var exportedGlobal = instance.exports[memName] || instance.exports['_' + memName];
                if (exportedGlobal) {
                    if (exportedGlobal instanceof WebAssembly.Global) {
                        GOTMem[memName].value = exportedGlobal.value;
                    } else if (typeof exportedGlobal === 'number') {
                        GOTMem[memName].value = exportedGlobal;
                    }
                } else {
                    console.warn('[ChuginLoader] GOT.mem: ChuGin does not export ' + memName);
                }
            }

            // Run WASM initializers (AFTER GOT is fully resolved)
            if (instance.exports.__wasm_apply_data_relocs) {
                instance.exports.__wasm_apply_data_relocs();
            }
            if (instance.exports.__wasm_call_ctors) {
                instance.exports.__wasm_call_ctors();
            }

            // Get ck_query and add to function table
            var ckQuery = instance.exports.ck_query || instance.exports._ck_query;
            if (!ckQuery) {
                console.error('[ChuginLoader] No ck_query export in ' + fsPath);
                return -1;
            }

            var funcIndex = Module.addFunction(ckQuery, 'ii');
            var name = fsPath.split('/').pop().replace('.chug.wasm', '');
            this.loadedChugins.push({ name: name, funcIndex: funcIndex, path: fsPath });

            console.log('[ChuginLoader] Loaded ' + name + ' at index ' + funcIndex);
            return funcIndex;

        } catch (e) {
            console.error('[ChuginLoader] Failed: ' + fsPath + ' - ' + e.message);
            return -1;
        }
    },

    loadAllPending: function() {
        var results = [];
        for (var i = 0; i < this.pendingChugins.length; i++) {
            var funcIndex = this.loadChugin(this.pendingChugins[i]);
            if (funcIndex >= 0) {
                var name = this.pendingChugins[i].split('/').pop().replace('.chug.wasm', '');
                results.push({ name: name, funcIndex: funcIndex });
            }
        }
        this.pendingChugins = [];
        return results;
    },

    getPendingCount: function() {
        return this.pendingChugins.length;
    }
};

window.ChuginLoader = ChuginLoader;
