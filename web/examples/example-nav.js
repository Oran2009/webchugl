// example-nav.js — shared nav panel for all WebChuGL examples
// Injects a back button + source code viewer with file tabs
(function() {
    'use strict';

    // ── Derive example folder name from URL path ──
    var parts = location.pathname.replace(/\/+$/, '').split('/');
    var folder = parts[parts.length - 1] || parts[parts.length - 2] || '';
    if (folder === 'index.html') folder = parts[parts.length - 2] || '';
    var ghUrl = 'https://github.com/ccrma/webchugl/tree/main/web/examples/' + folder + '/';

    // ── File definitions (base files; .ck files discovered dynamically) ──
    var files = [
        { name: 'index.html', lang: 'xml' },
        { name: 'index.js', lang: 'javascript' },
    ];
    var fileCache = {};   // name -> text content
    var activeFile = 'index.js';

    // ── Inject CSS ──
    var style = document.createElement('style');
    style.textContent = [
        '#xcgl-nav { position:fixed; top:12px; left:12px; z-index:10000;',
        '  display:flex; gap:6px; font:12px/1 monospace; user-select:none; }',
        '#xcgl-nav a, #xcgl-nav button {',
        '  background:rgba(15,15,25,0.88); color:#ccc; border:2px solid #444;',
        '  border-radius:5px; padding:6px 10px; text-decoration:none;',
        '  font:12px/1 monospace; cursor:pointer; margin:0; transition:background .15s,border-color .15s; }',
        '#xcgl-nav a:hover, #xcgl-nav button:hover { background:rgba(30,30,45,0.95); border-color:#888; color:#fff; }',
        '#xcgl-nav button.active { background:rgba(40,40,60,0.95); border-color:#f0c040; color:#f0c040; }',
        '',
        '#xcgl-src { position:fixed; top:50px; left:12px; width:min(560px,calc(90vw - 24px));',
        '  max-height:calc(100vh - 64px); z-index:9999;',
        '  background:rgba(12,12,18,0.96); border:2px solid #333; border-radius:8px;',
        '  display:flex; flex-direction:column; font:13px/1.5 monospace;',
        '  box-shadow:0 4px 24px rgba(0,0,0,0.5);',
        '  opacity:0; pointer-events:none; transform:translateY(-8px);',
        '  transition:opacity .2s ease,transform .2s ease; }',
        '#xcgl-src.open { opacity:1; pointer-events:auto; transform:translateY(0); }',
        '',
        '#xcgl-src-header { display:flex; align-items:center; gap:8px; padding:10px 14px;',
        '  background:rgba(255,255,255,0.04); border-bottom:1px solid #333; flex-shrink:0;',
        '  border-radius:8px 8px 0 0; }',
        '#xcgl-src-header .spacer { flex:1; }',
        '#xcgl-src-header a { color:#f0c040; font-size:12px; text-decoration:none; }',
        '#xcgl-src-header a:hover { text-decoration:underline; }',
        '#xcgl-src-header button { background:none; border:none; color:#888; font-size:18px;',
        '  cursor:pointer; padding:0 4px; line-height:1; }',
        '#xcgl-src-header button:hover { color:#fff; }',
        '',
        '#xcgl-tabs { display:flex; gap:0; flex-shrink:0; border-bottom:1px solid #333; }',
        '#xcgl-tabs button { background:none; border:none; border-bottom:2px solid transparent;',
        '  color:#888; font:13px/1.5 monospace; padding:8px 14px; cursor:pointer;',
        '  transition:color .15s,border-color .15s; }',
        '#xcgl-tabs button:hover { color:#ccc; }',
        '#xcgl-tabs button.active { color:#f0c040; border-bottom-color:#f0c040; }',
        '',
        '#xcgl-src-code { flex:1; overflow-y:auto; overflow-x:hidden; margin:0; padding:14px;',
        '  min-height:0; }',
        '#xcgl-src-code code { font-size:12px; line-height:1.5; white-space:pre-wrap;',
        '  word-break:break-all; color:#ccc; background:none !important; padding:0 !important; }',
        '',
        '/* Scrollbar styling */',
        '#xcgl-src-code::-webkit-scrollbar { width:8px; height:8px; }',
        '#xcgl-src-code::-webkit-scrollbar-track { background:rgba(255,255,255,0.03); }',
        '#xcgl-src-code::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.15); border-radius:4px; }',
        '#xcgl-src-code::-webkit-scrollbar-thumb:hover { background:rgba(255,255,255,0.25); }',
        '#xcgl-src-code { scrollbar-width:thin; scrollbar-color:rgba(255,255,255,0.15) rgba(255,255,255,0.03); }',
    ].join('\n');
    document.head.appendChild(style);

    // ── Build DOM ──
    // Nav bar
    var nav = document.createElement('div');
    nav.id = 'xcgl-nav';
    var back = document.createElement('a');
    back.href = '../../#' + folder;
    back.textContent = '\u2190 Back';
    back.title = 'Back to WebChuGL';
    var srcBtn = document.createElement('button');
    srcBtn.textContent = '<> Source';
    nav.appendChild(back);
    nav.appendChild(srcBtn);

    // Source panel
    var panel = document.createElement('div');
    panel.id = 'xcgl-src';

    // Header (copy, spacer, github, close)
    var header = document.createElement('div');
    header.id = 'xcgl-src-header';
    var copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.title = 'Copy to clipboard';
    copyBtn.style.cssText = 'font:13px/1.5 monospace;';
    var spacer = document.createElement('span');
    spacer.className = 'spacer';
    var ghLink = document.createElement('a');
    ghLink.href = ghUrl;
    ghLink.target = '_blank';
    ghLink.textContent = 'GitHub \u2197';
    var closeBtn = document.createElement('button');
    closeBtn.textContent = '\u00d7';
    closeBtn.title = 'Close';
    header.appendChild(copyBtn);
    header.appendChild(spacer);
    header.appendChild(ghLink);
    header.appendChild(closeBtn);

    // Tab bar
    var tabBar = document.createElement('div');
    tabBar.id = 'xcgl-tabs';
    var tabButtons = {};

    function addTab(f) {
        var btn = document.createElement('button');
        btn.textContent = f.name;
        btn.dataset.file = f.name;
        if (f.name === activeFile) btn.classList.add('active');
        tabBar.appendChild(btn);
        tabButtons[f.name] = btn;
        files.push(f);
    }

    // Add base tabs
    [{ name: 'index.html', lang: 'xml' }, { name: 'index.js', lang: 'javascript' }].forEach(function(f) {
        var btn = document.createElement('button');
        btn.textContent = f.name;
        btn.dataset.file = f.name;
        if (f.name === activeFile) btn.classList.add('active');
        tabBar.appendChild(btn);
        tabButtons[f.name] = btn;
    });

    // Code area
    var codePre = document.createElement('pre');
    codePre.id = 'xcgl-src-code';
    var codeEl = document.createElement('code');
    codeEl.className = 'language-javascript';
    codeEl.textContent = 'Loading...';
    codePre.appendChild(codeEl);

    panel.appendChild(header);
    panel.appendChild(tabBar);
    panel.appendChild(codePre);

    document.body.appendChild(nav);
    document.body.appendChild(panel);

    // ── File loading ──
    function loadFile(name) {
        if (fileCache[name] !== undefined) {
            showFile(name);
            return;
        }
        codeEl.textContent = 'Loading...';
        // Reset highlighting class
        codeEl.className = '';
        fetch('./' + name)
            .then(function(r) {
                if (!r.ok) throw new Error(r.status);
                return r.text();
            })
            .then(function(text) {
                fileCache[name] = text;
                // If still on this tab, show it
                if (activeFile === name) showFile(name);
            })
            .catch(function() {
                fileCache[name] = null;
                if (activeFile === name) {
                    codeEl.textContent = '// File not found';
                    // Hide the tab for missing files
                    if (tabButtons[name]) tabButtons[name].style.display = 'none';
                    // Switch to first visible tab
                    for (var i = 0; i < files.length; i++) {
                        if (tabButtons[files[i].name].style.display !== 'none') {
                            switchTab(files[i].name);
                            break;
                        }
                    }
                }
            });
    }

    function showFile(name) {
        codeEl.textContent = fileCache[name] || '// Empty file';
        // Set language class for highlight.js
        var lang = 'javascript';
        for (var i = 0; i < files.length; i++) {
            if (files[i].name === name) { lang = files[i].lang; break; }
        }
        codeEl.className = 'language-' + lang;
        highlight();
    }

    function switchTab(name) {
        activeFile = name;
        // Update tab buttons
        for (var key in tabButtons) {
            tabButtons[key].classList.toggle('active', key === name);
        }
        loadFile(name);
    }

    // Tab click handler
    tabBar.addEventListener('click', function(e) {
        var btn = e.target;
        if (btn.dataset && btn.dataset.file) {
            switchTab(btn.dataset.file);
        }
    });

    // ── Toggle logic ──
    var isOpen = false;
    var firstOpen = true;

    function toggle() {
        isOpen = !isOpen;
        panel.classList.toggle('open', isOpen);
        srcBtn.classList.toggle('active', isOpen);
        if (isOpen && firstOpen) {
            firstOpen = false;
            loadFile(activeFile);
            // Discover .ck files referenced in index.js
            fetch('./index.js')
                .then(function(r) { return r.ok ? r.text() : ''; })
                .then(function(src) {
                    var seen = {};
                    var re = /['"]\.\/([^'"]+\.ck)['"]/g;
                    var m;
                    while ((m = re.exec(src)) !== null) {
                        if (!seen[m[1]]) {
                            seen[m[1]] = true;
                            addTab({ name: m[1], lang: 'chuck' });
                        }
                    }
                    // Fallback: probe for main.ck if nothing found
                    if (Object.keys(seen).length === 0) {
                        fetch('./main.ck', { method: 'HEAD' })
                            .then(function(r) {
                                if (r.ok) addTab({ name: 'main.ck', lang: 'chuck' });
                            })
                            .catch(function() {});
                    }
                })
                .catch(function() {});
        }
    }

    srcBtn.addEventListener('click', toggle);
    closeBtn.addEventListener('click', function() { if (isOpen) toggle(); });
    copyBtn.addEventListener('click', function() {
        var text = fileCache[activeFile];
        if (!text) return;
        navigator.clipboard.writeText(text).then(function() {
            copyBtn.textContent = 'Copied!';
            setTimeout(function() { copyBtn.textContent = 'Copy'; }, 1500);
        });
    });

    // ── Custom ChucK language definition for highlight.js ──
    function chuckLanguage(hljs) {
        var CHUCK_KEYWORDS = {
            keyword:
                'if else while until for do repeat loop break continue return ' +
                'class extends public private protected static pure const ' +
                'new function fun spork cherr chout ' +
                'null NULL true false maybe me now ' +
                'implements interface global',
            type:
                'int float time dur void string complex polar ' +
                'vec2 vec3 vec4 Object Event UGen UAna Type',
            built_in:
                // Audio I/O
                'dac adc blackhole ' +
                // Oscillators
                'SinOsc SqrOsc SawOsc TriOsc PulseOsc SquareOsc Phasor ' +
                'Noise Impulse Step ' +
                // Envelopes
                'ADSR Envelope ' +
                // Gain & mixing
                'Gain Pan2 Mix2 ' +
                // Delays & reverbs
                'Delay DelayA DelayL Echo JCRev NRev PRCRev Chorus Modulate PitShift ' +
                // Filters
                'LPF HPF BPF BRF ResonZ BiQuad OnePole TwoPole OneZero TwoZero PoleZero Dyno ' +
                // Buffers & I/O
                'SndBuf SndBuf2 WvIn WvOut WvOut2 LiSa ' +
                // Analysis
                'FFT IFFT UAnaBlob Windowing Flip pilF DCT IDCT FeatureCollector Centroid Flux RMS RollOff ' +
                // STK instruments
                'BandedWG BlowBotl BlowHole Bowed Brass Clarinet Flute Mandolin ' +
                'ModalBar Moog Saxofony Shakers Sitar StifKarp VoicForm ' +
                'FM BeeThree FMVoices HevyMetl PercFlut Rhodey TubeBell Wurley ' +
                // Blit
                'Blit BlitSaw BlitSquare ' +
                // Gen
                'GenX CurveTable WarpTable ' +
                // ChuGL graphics
                'GG GGen GScene GCircle GPlane GCube GSphere GLines GText GPoints GModel GMesh ' +
                'GCamera GWindow GOrbitCamera FlatMaterial PhongMaterial NormalMaterial ' +
                'MangoUVMaterial ShaderMaterial Color ' +
                // Stdlib
                'Math Std Machine Type',
            literal:
                'true false null NULL maybe pi'
        };

        var CHUCK_OPERATORS = {
            className: 'operator',
            begin: /=>|=<|!=>|=\^|@=>|\+=>\|-=>|\*=>|\/=>|%=>|-->|--<|~>/
        };

        var TIME_LITERAL = {
            className: 'number',
            begin: /\b\d+(\.\d+)?\s*::\s*(samp|ms|second|minute|hour|day|week)\b/
        };

        var VECTOR_LITERAL = {
            className: 'number',
            begin: /@\(/,
            end: /\)/,
            contains: [hljs.C_NUMBER_MODE]
        };

        var DEBUG_PRINT = {
            className: 'string',
            begin: /<<</,
            end: />>>/,
            contains: [hljs.BACKSLASH_ESCAPE]
        };

        return {
            name: 'ChucK',
            aliases: ['chuck', 'ck'],
            keywords: CHUCK_KEYWORDS,
            contains: [
                hljs.C_LINE_COMMENT_MODE,
                hljs.C_BLOCK_COMMENT_MODE,
                hljs.QUOTE_STRING_MODE,
                hljs.C_NUMBER_MODE,
                TIME_LITERAL,
                VECTOR_LITERAL,
                DEBUG_PRINT,
                CHUCK_OPERATORS,
                {
                    // spork ~
                    className: 'keyword',
                    begin: /\bspork\s+~/
                },
                {
                    // function/fun declarations
                    className: 'title.function',
                    begin: /\b(fun|function)\s+\w+\s+/,
                    end: /\(/,
                    excludeEnd: true,
                    keywords: CHUCK_KEYWORDS,
                    contains: [{ className: 'title.function', begin: /\w+$/ }]
                }
            ]
        };
    }

    // ── Syntax highlighting (lazy-load highlight.js) ──
    var hlReady = false;
    var hlLoading = false;

    function highlight() {
        if (hlReady && window.hljs) {
            // Re-highlight: reset and re-apply
            codeEl.removeAttribute('data-highlighted');
            window.hljs.highlightElement(codeEl);
            return;
        }
        if (hlLoading) return;
        hlLoading = true;

        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/androidstudio.min.css';
        document.head.appendChild(link);

        var script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js';
        script.onload = function() {
            hlReady = true;
            if (window.hljs) {
                // Register custom ChucK language
                window.hljs.registerLanguage('chuck', chuckLanguage);
                window.hljs.highlightElement(codeEl);
            }
        };
        document.head.appendChild(script);
    }
})();
