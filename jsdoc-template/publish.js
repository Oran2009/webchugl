'use strict';

var path = require('path');
var helper = require('jsdoc/util/templateHelper');
var fs = require('jsdoc/fs');
var env = require('jsdoc/env');

// ── Method grouping ──────────────────────────────────────────────────────

var METHOD_GROUPS = [
    {
        title: 'Code Execution',
        methods: ['runCode', 'runFile', 'runZip']
    },
    {
        title: 'Virtual Filesystem',
        methods: ['createFile', 'removeFile', 'fileExists', 'listFiles', 'loadFile', 'loadFiles', 'loadZip']
    },
    {
        title: 'Audio',
        methods: ['loadAudio', 'initMidi', 'getSampleRate']
    },
    {
        title: 'Scalar Variables',
        methods: ['setInt', 'setFloat', 'setString', 'getInt', 'getFloat', 'getString']
    },
    {
        title: 'Int Arrays',
        methods: ['setIntArray', 'getIntArray', 'setIntArrayValue', 'getIntArrayValue',
                  'setAssocIntArrayValue', 'getAssocIntArrayValue']
    },
    {
        title: 'Float Arrays',
        methods: ['setFloatArray', 'getFloatArray', 'setFloatArrayValue', 'getFloatArrayValue',
                  'setAssocFloatArrayValue', 'getAssocFloatArrayValue']
    },
    {
        title: 'Events',
        methods: ['signalEvent', 'broadcastEvent', 'listenForEvent', 'listenForEventOnce',
                  'stopListeningForEvent', 'startListeningForEvent']
    },
    {
        title: 'ChuGins & Packages',
        methods: ['loadChugin', 'getLoadedChugins', 'loadPackage']
    },
    {
        title: 'VM',
        methods: ['getCurrentTime', 'getActiveShreds', 'getLastError', 'getGlobalVariables']
    },
    {
        title: 'Persistent Storage',
        methods: ['save', 'load', 'delete', 'listKeys']
    }
];

// ── HTML helpers ─────────────────────────────────────────────────────────

function esc(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function typeStr(param) {
    if (!param.type || !param.type.names) return '';
    return param.type.names.join(' | ');
}

function slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// ── Render a single method/function ──────────────────────────────────────

function renderMethod(method) {
    var params = (method.params || []).filter(function(p) { return p.name; });
    var returns = method.returns || [];
    var examples = method.examples || [];

    // Build signature: name(p1, p2, ...)
    var sigParams = params
        .filter(function(p) { return p.name.indexOf('.') === -1; })
        .map(function(p) { return p.optional ? p.name + '?' : p.name; });
    var sig = method.name + '(' + sigParams.join(', ') + ')';

    // Return type
    var retType = returns.length && returns[0].type
        ? returns[0].type.names.join(' | ') : '';

    var html = '<div class="method" id="' + esc(method.name) + '">';

    // Signature line
    html += '<h4 class="method-sig"><code>' + esc(sig) + '</code>';
    if (retType) {
        html += ' <span class="arrow">&rarr;</span> <span class="ret-type">' + esc(retType) + '</span>';
    }
    html += '</h4>';

    // Description
    if (method.description) {
        html += '<div class="method-desc">' + method.description + '</div>';
    }

    // Params table
    if (params.length > 0) {
        html += '<table class="params-table"><thead><tr>';
        html += '<th scope="col">Parameter</th><th scope="col">Type</th><th scope="col">Description</th>';
        html += '</tr></thead><tbody>';
        params.forEach(function(p) {
            var isSub = p.name.indexOf('.') !== -1;
            var displayName = isSub ? p.name.split('.').pop() : p.name;
            var depth = (p.name.match(/\./g) || []).length;
            var cls = depth > 0 ? ' class="sub sub-' + depth + '"' : '';

            html += '<tr' + cls + '>';
            html += '<td><code>' + esc(displayName) + '</code>';
            if (p.optional) html += ' <span class="opt">optional</span>';
            if (typeof p.defaultvalue !== 'undefined') {
                html += ' <span class="def">= ' + esc(String(p.defaultvalue)) + '</span>';
            }
            html += '</td>';
            html += '<td><code class="type">' + esc(typeStr(p)) + '</code></td>';
            html += '<td>' + (p.description || '') + '</td>';
            html += '</tr>';
        });
        html += '</tbody></table>';
    }

    // Returns description
    if (returns.length && returns[0].description) {
        html += '<p class="returns"><span class="label">Returns:</span> ' + returns[0].description + '</p>';
    }

    // Examples
    examples.forEach(function(ex) {
        var code = typeof ex === 'string' ? ex : (ex.code || String(ex));
        html += '<pre><code class="language-javascript">' + esc(code) + '</code></pre>';
    });

    html += '</div>';
    return html;
}

// ── Render a member (property) ───────────────────────────────────────────

function renderMember(member) {
    var type = member.type ? member.type.names.join(' | ') : '';
    var html = '<div class="method" id="' + esc(member.name) + '">';
    html += '<h4 class="method-sig"><code>' + esc(member.name) + '</code>';
    if (type) {
        html += ' <span class="ret-type">: ' + esc(type) + '</span>';
    }
    html += ' <span class="badge">property</span></h4>';
    if (member.description) {
        html += '<div class="method-desc">' + member.description + '</div>';
    }
    html += '</div>';
    return html;
}

// ── Render method TOC (pill links) ───────────────────────────────────────

function renderToc(items) {
    var html = '<div class="method-toc">';
    items.forEach(function(item) {
        html += '<a href="#' + esc(item.name) + '">' + esc(item.name) + '</a>';
    });
    html += '</div>';
    return html;
}

// ── Render a collapsible method group ────────────────────────────────────

function renderGroup(title, items, renderFn) {
    var count = items.length;
    var id = slugify(title);
    var html = '<details class="group" id="' + esc(id) + '" open>\n';
    html += '<summary class="group-title">' + esc(title);
    html += ' <span class="group-count">' + count + '</span></summary>\n';
    html += '<div class="details-content" style="grid-template-rows:1fr"><div class="details-inner">\n';
    html += renderToc(items);
    items.forEach(function(m) {
        html += renderFn(m);
    });
    html += '</div></div>\n';
    html += '</details>\n';
    return html;
}

// ── Build full page ──────────────────────────────────────────────────────

function buildPage(chuckClass, chuckMethods, chuckMembers, chuglNamespace, chuglMethods) {
    var html = '';

    html += '<!DOCTYPE html>\n';
    html += '<html lang="en">\n<head>\n';
    html += '<meta charset="utf-8">\n';
    html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n';
    html += '<title>WebChuGL Documentation</title>\n';
    html += '<link rel="stylesheet" href="style.css">\n';
    html += '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/androidstudio.min.css">\n';
    html += '</head>\n<body>\n';
    html += '<a href="#getting-started" class="skip-link">Skip to main content</a>\n';
    html += '<div class="page-layout">\n';
    html += '<main class="content">\n';

    // ── Header (canvas hero) ──
    html += '<header class="hero">\n';
    html += '<canvas id="hero-canvas"></canvas>\n';
    html += '<div class="hero-overlay">\n';
    html += '<h1>docs =&gt; now</h1>\n';
    html += '<p class="tagline">WebChuGL Documentation</p>\n';
    html += '<nav class="nav-links" aria-label="Primary">\n';
    html += '<a href="https://chuck.stanford.edu/chugl/api/" target="_blank" class="btn-orange">ChuGL API</a>\n';
    html += '<a href="http://chuck.stanford.edu/doc/reference" target="_blank" class="btn-green">ChucK API</a>\n';
    html += '<a href="../" class="btn-orange">Back to WebChuGL</a>\n';
    html += '</nav>\n';
    html += '</div>\n';
    html += '</header>\n';

    // ── Getting Started section ──
    html += '<details class="top-section" id="getting-started" open>\n';
    html += '<summary><h2>Getting Started</h2></summary>\n';
    html += '<div class="details-content" style="grid-template-rows:1fr"><div class="details-inner">\n';

    html += '<h3 id="quick-start-esm">Quick Start (ESM)</h3>\n';
    html += '<p>All you need is a browser with <a href="https://caniuse.com/webgpu" target="_blank">WebGPU support</a> (Chrome 113+, Edge 113+, Firefox Nightly).</p>\n';
    html += '<p>1. Create an <code>index.html</code>:</p>\n';
    html += '<pre><code class="language-html">&lt;canvas id="canvas"&gt;&lt;/canvas&gt;\n';
    html += '&lt;script type="module"&gt;\n';
    html += '    import ChuGL from \'https://cdn.jsdelivr.net/npm/webchugl/+esm\';\n';
    html += '\n';
    html += '    var ck = await ChuGL.init({\n';
    html += '        canvas: document.getElementById(\'canvas\'),\n';
    html += '    });\n';
    html += '\n';
    html += '    // Run ChucK code directly\n';
    html += '    ck.runCode(\'SinOsc s =&gt; dac; while(true) GG.nextFrame() =&gt; now;\');\n';
    html += '\n';
    html += '    // Or run a .ck file (fetched automatically)\n';
    html += '    await ck.runFile(\'./main.ck\');\n';
    html += '&lt;/script&gt;</code></pre>\n';

    html += '<p>2. Serve with any HTTP server. See <a href="#cross-origin-isolation">Cross-Origin Isolation</a> below for enabling <code>SharedArrayBuffer</code>.</p>\n';

    html += '<p>You can also import from a self-hosted build:</p>\n';
    html += '<pre><code class="language-js">import ChuGL from \'./webchugl/webchugl-esm.js\';\n';
    html += '\n';
    html += 'var ck = await ChuGL.init({\n';
    html += '    canvas: document.getElementById(\'canvas\'),\n';
    html += '    whereIsChuGL: \'./webchugl/\',\n';
    html += '});</code></pre>\n';

    html += '<h3 id="deploying-a-project">Deploying a Project</h3>\n';
    html += '<p>Package your <code>.ck</code> files, assets (audio, textures, data), and any <code>.chug.wasm</code> ChuGins into a zip file. Use <code>main.ck</code> as the entry point.</p>\n';
    html += '<pre><code class="language-bash">zip -r bundle.zip main.ck lib/ assets/</code></pre>\n';
    html += '<p>Then create an <code>index.html</code>:</p>\n';
    html += '<pre><code class="language-html">&lt;!DOCTYPE html&gt;\n';
    html += '&lt;html&gt;\n';
    html += '&lt;head&gt;\n';
    html += '    &lt;meta charset="utf-8"&gt;\n';
    html += '    &lt;style&gt;\n';
    html += '        body { margin: 0; background: #000; }\n';
    html += '        canvas { width: 100%; height: 100vh; display: block; }\n';
    html += '    &lt;/style&gt;\n';
    html += '&lt;/head&gt;\n';
    html += '&lt;body&gt;\n';
    html += '    &lt;canvas id="canvas"&gt;&lt;/canvas&gt;\n';
    html += '    &lt;script type="module"&gt;\n';
    html += '        import ChuGL from \'https://cdn.jsdelivr.net/npm/webchugl/+esm\';\n';
    html += '\n';
    html += '        var ck = await ChuGL.init({\n';
    html += '            canvas: document.getElementById(\'canvas\'),\n';
    html += '        });\n';
    html += '\n';
    html += '        await ck.runZip(\'./bundle.zip\');\n';
    html += '    &lt;/script&gt;\n';
    html += '&lt;/body&gt;\n';
    html += '&lt;/html&gt;</code></pre>\n';
    html += '<p>Download <a href="https://github.com/ccrma/webchugl/blob/main/examples/sw.js" target="_blank">sw.js</a> and place it in the same directory as your <code>index.html</code> (or configure your server to send <a href="#cross-origin-isolation">COOP/COEP headers</a> directly). Then upload <code>index.html</code>, <code>bundle.zip</code>, and <code>sw.js</code> to any static hosting provider (Netlify, Vercel, GitHub Pages, etc.) and share the URL!</p>\n';

    html += '<h3 id="building-from-source">Building from Source</h3>\n';
    html += '<p>To build WebChuGL from source (for development or custom builds):</p>\n';
    html += '<h4>Prerequisites</h4>\n';
    html += '<ul><li><a href="https://git-scm.com/" target="_blank">Git</a></li>';
    html += '<li><a href="https://www.python.org/" target="_blank">Python 3</a> (for Emscripten)</li>';
    html += '<li>CMake</li></ul>\n';
    html += '<h4>Setup &amp; Build</h4>\n';
    html += '<pre><code class="language-bash">git clone https://github.com/ccrma/webchugl.git\n';
    html += 'cd webchugl\n';
    html += './setup.sh          # Linux/macOS (or ./setup.ps1 on Windows)\n';
    html += '\n';
    html += 'cd src/scripts\n';
    html += './build.sh          # compiles C++/WASM (or ./build.ps1 on Windows)</code></pre>\n';
    html += '<p>Output goes to <code>src/build/</code>. The <code>webchugl/</code> subdirectory contains the runtime assets.</p>\n';

    html += '</div></div>\n';
    html += '</details>\n';

    // ── Cross-Origin Isolation section ──
    html += '<details class="top-section" id="cross-origin-isolation" open>\n';
    html += '<summary><h2>Cross-Origin Isolation</h2></summary>\n';
    html += '<div class="details-content" style="grid-template-rows:1fr"><div class="details-inner">\n';

    html += '<p>WebChuGL&rsquo;s audio engine uses <code>SharedArrayBuffer</code>, which browsers only enable in <a href="https://developer.mozilla.org/en-US/docs/Web/API/crossOriginIsolated" target="_blank">cross-origin isolated</a> contexts. There are two easy ways to enable this:</p>\n';

    html += '<h3>Option 1: Service Worker (default)</h3>\n';
    html += '<p>WebChuGL ships with <code>sw.js</code>, a service worker that injects the required headers on every response. Copy <code>sw.js</code> to the root of your site and serve with any HTTP server. WebChuGL registers it automatically.</p>\n';
    html += '<p>The service worker adds these headers:</p>\n';
    html += '<pre><code>Cross-Origin-Opener-Policy: same-origin\nCross-Origin-Embedder-Policy: credentialless</code></pre>\n';
    html += '<p>On first load, the page may reload once to activate the service worker. To disable it (e.g., if your server already sends headers), pass <code>serviceWorker: false</code> in the init config.</p>\n';

    html += '<h3>Option 2: Server Headers</h3>\n';
    html += '<p>Configure your server to send these headers on all HTML responses:</p>\n';
    html += '<pre><code>Cross-Origin-Opener-Policy: same-origin\nCross-Origin-Embedder-Policy: credentialless</code></pre>\n';

    html += '</div></div>\n';
    html += '</details>\n';

    // ── ChuGL section (collapsible) ──
    html += '<details class="top-section" id="ChuGL" open>\n';
    html += '<summary><h2>ChuGL Entry Point</h2></summary>\n';
    html += '<div class="details-content" style="grid-template-rows:1fr"><div class="details-inner">\n';
    if (chuglNamespace && chuglNamespace.description) {
        html += '<div class="section-desc">' + chuglNamespace.description + '</div>';
    }

    chuglMethods.forEach(function(m) {
        html += renderMethod(m);
    });

    html += '</div></div>\n';
    html += '</details>\n';

    // ── ChucK section (collapsible) ──
    html += '<details class="top-section" id="ChucK" open>\n';
    html += '<summary><h2>ChucK Instance</h2></summary>\n';
    html += '<div class="details-content" style="grid-template-rows:1fr"><div class="details-inner">\n';
    if (chuckClass && chuckClass.classdesc) {
        html += '<div class="section-desc">' + chuckClass.classdesc + '</div>';
    } else if (chuckClass && chuckClass.description) {
        html += '<div class="section-desc">' + chuckClass.description + '</div>';
    }

    // Members
    if (chuckMembers.length > 0) {
        html += renderGroup('Properties', chuckMembers, renderMember);
    }

    // Grouped methods
    var usedMethods = {};
    METHOD_GROUPS.forEach(function(group) {
        var items = group.methods
            .map(function(name) {
                return chuckMethods.filter(function(m) { return m.name === name; })[0];
            })
            .filter(Boolean);

        if (items.length === 0) return;

        items.forEach(function(m) { usedMethods[m.name] = true; });

        html += renderGroup(group.title, items, renderMethod);
    });

    // Ungrouped methods (safety net)
    var ungrouped = chuckMethods.filter(function(m) { return !usedMethods[m.name]; });
    if (ungrouped.length > 0) {
        html += renderGroup('Other', ungrouped, renderMethod);
    }

    html += '</div></div>\n';
    html += '</details>\n';

    // ── Footer ──
    html += '<footer class="footer">\n';
    html += '<nav aria-label="Footer">\n';
    html += '<a href="../">Back to WebChuGL</a> &middot; ';
    html += '<a href="https://github.com/ccrma/webchugl">GitHub</a> &middot; ';
    html += '<a href="https://chuck.stanford.edu/chugl/">ChuGL</a> &middot; ';
    html += '<a href="https://chuck.stanford.edu/">ChucK</a>\n';
    html += '</nav>\n';
    html += '</footer>\n';

    html += '</main>\n'; // end .content

    // ── Sidebar (TOC + Back to Top) ──
    html += '<aside class="sidebar">\n';
    html += '<nav class="toc-sidebar" aria-label="Table of contents">\n';
    // Getting Started + sub-sections
    html += '<a href="#getting-started">Getting Started</a>\n';
    html += '<a href="#quick-start-esm" class="toc-sub">Quick Start (ESM)</a>\n';
    html += '<a href="#deploying-a-project" class="toc-sub">Deploying a Project</a>\n';
    html += '<a href="#building-from-source" class="toc-sub">Building from Source</a>\n';
    // Cross-Origin Isolation
    html += '<a href="#cross-origin-isolation">Cross-Origin Isolation</a>\n';
    // ChuGL
    html += '<a href="#ChuGL">ChuGL Entry Point</a>\n';
    // ChucK + method groups
    html += '<a href="#ChucK">ChucK Instance</a>\n';
    if (chuckMembers.length > 0) {
        html += '<a href="#properties" class="toc-sub">Properties</a>\n';
    }
    METHOD_GROUPS.forEach(function(group) {
        var hasItems = group.methods.some(function(name) {
            return chuckMethods.some(function(m) { return m.name === name; });
        });
        if (hasItems) {
            html += '<a href="#' + slugify(group.title) + '" class="toc-sub">' + esc(group.title) + '</a>\n';
        }
    });
    html += '</nav>\n';
    html += '<a href="#" class="back-to-top" aria-label="Back to top">&#x25B2;</a>\n';
    html += '</aside>\n';

    html += '</div>\n'; // end .page-layout

    html += '<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>\n';
    html += '<script>hljs.highlightAll();</script>\n';

    // Animated <details> open/close
    html += '<script>\n';
    html += 'document.querySelectorAll("details").forEach(function(d) {\n';
    html += '  var content = d.querySelector(".details-content");\n';
    html += '  if (!content) return;\n';
    html += '  d.querySelector("summary").addEventListener("click", function(e) {\n';
    html += '    e.preventDefault();\n';
    html += '    if (d.open) {\n';
    html += '      content.style.gridTemplateRows = "0fr";\n';
    html += '      content.addEventListener("transitionend", function handler() {\n';
    html += '        d.removeAttribute("open");\n';
    html += '        content.removeEventListener("transitionend", handler);\n';
    html += '      });\n';
    html += '    } else {\n';
    html += '      d.setAttribute("open", "");\n';
    html += '      requestAnimationFrame(function() {\n';
    html += '        content.style.gridTemplateRows = "1fr";\n';
    html += '      });\n';
    html += '    }\n';
    html += '  });\n';
    html += '});\n';
    html += '</script>\n';

    // Back to Top button visibility + TOC active section highlight
    html += '<script>\n';
    html += '(function() {\n';
    html += '  var btn = document.querySelector(".back-to-top");\n';
    html += '  var tocLinks = document.querySelectorAll(".toc-sidebar a");\n';
    html += '  var sections = [];\n';
    html += '  tocLinks.forEach(function(a) {\n';
    html += '    var id = a.getAttribute("href").slice(1);\n';
    html += '    var el = document.getElementById(id);\n';
    html += '    if (el) sections.push({ id: id, el: el, link: a });\n';
    html += '  });\n';
    html += '  function updateSidebar() {\n';
    html += '    btn.classList.toggle("visible", window.scrollY > 400);\n';
    html += '    // Active section highlight\n';
    html += '    var current = "";\n';
    html += '    sections.forEach(function(s) {\n';
    html += '      if (s.el.getBoundingClientRect().top <= 120) current = s.id;\n';
    html += '    });\n';
    html += '    tocLinks.forEach(function(a) {\n';
    html += '      a.classList.toggle("active", a.getAttribute("href") === "#" + current);\n';
    html += '    });\n';
    html += '  }\n';
    html += '  window.addEventListener("scroll", updateSidebar, { passive: true });\n';
    html += '  updateSidebar();\n';
    html += '  btn.addEventListener("click", function(e) {\n';
    html += '    e.preventDefault();\n';
    html += '    window.scrollTo({ top: 0, behavior: "smooth" });\n';
    html += '  });\n';
    html += '\n';
    html += '  // TOC collapse: hide sub-items when parent section is collapsed\n';
    html += '  var tocGroups = [];\n';
    html += '  var currentGroup = null;\n';
    html += '  tocLinks.forEach(function(a) {\n';
    html += '    if (!a.classList.contains("toc-sub")) {\n';
    html += '      var id = a.getAttribute("href").slice(1);\n';
    html += '      currentGroup = { parent: a, subs: [], details: document.getElementById(id) };\n';
    html += '      tocGroups.push(currentGroup);\n';
    html += '    } else if (currentGroup) {\n';
    html += '      currentGroup.subs.push(a);\n';
    html += '    }\n';
    html += '  });\n';
    html += '\n';
    html += '  function updateTocCollapse() {\n';
    html += '    tocGroups.forEach(function(g) {\n';
    html += '      if (!g.details || g.details.tagName !== "DETAILS") return;\n';
    html += '      var isOpen = g.details.hasAttribute("open");\n';
    html += '      g.subs.forEach(function(s) { s.classList.toggle("collapsed", !isOpen); });\n';
    html += '    });\n';
    html += '  }\n';
    html += '\n';
    html += '  var obs = new MutationObserver(updateTocCollapse);\n';
    html += '  tocGroups.forEach(function(g) {\n';
    html += '    if (g.details && g.details.tagName === "DETAILS")\n';
    html += '      obs.observe(g.details, { attributes: true, attributeFilter: ["open"] });\n';
    html += '  });\n';
    html += '  updateTocCollapse();\n';
    html += '\n';
    html += '  // Clicking a collapsed section sub-item opens the section first\n';
    html += '  tocLinks.forEach(function(a) {\n';
    html += '    if (!a.classList.contains("toc-sub")) return;\n';
    html += '    a.addEventListener("click", function(e) {\n';
    html += '      var targetId = a.getAttribute("href").slice(1);\n';
    html += '      var parentGroup = null;\n';
    html += '      tocGroups.forEach(function(g) {\n';
    html += '        g.subs.forEach(function(s) { if (s === a) parentGroup = g; });\n';
    html += '      });\n';
    html += '      if (parentGroup && parentGroup.details && !parentGroup.details.hasAttribute("open")) {\n';
    html += '        e.preventDefault();\n';
    html += '        var content = parentGroup.details.querySelector(".details-content");\n';
    html += '        parentGroup.details.setAttribute("open", "");\n';
    html += '        requestAnimationFrame(function() {\n';
    html += '          if (content) content.style.gridTemplateRows = "1fr";\n';
    html += '          setTimeout(function() {\n';
    html += '            var target = document.getElementById(targetId);\n';
    html += '            if (target) target.scrollIntoView({ behavior: "smooth" });\n';
    html += '          }, 550);\n';
    html += '        });\n';
    html += '      }\n';
    html += '    });\n';
    html += '  });\n';
    html += '})();\n';
    html += '</script>\n';

    // Hero WebChuGL embed (progressive enhancement)
    html += '<script type="module">\n';
    html += '(async function() {\n';
    html += '    if (!navigator.gpu) return;\n';
    html += '    var canvas = document.getElementById("hero-canvas");\n';
    html += '    if (!canvas) return;\n';
    html += '    try {\n';
    html += '        var mod = await import("https://cdn.jsdelivr.net/npm/webchugl/+esm");\n';
    html += '        var ck = await mod.default.init({\n';
    html += '            canvas: canvas,\n';
    html += '            whereIsChuGL: "../src/",\n';
    html += '            serviceWorker: false,\n';
    html += '        });\n';
    html += '        canvas.classList.add("ready");\n';
    html += '        ck.runCode([\n';
    html += "            'GWindow.title(\"WebChuGL Documentation\");',\n";
    html += '            "GGen sunSystem, earthSystem, moonSystem;",\n';
    html += '            "GSphere sun, earth, moon;",\n';
    html += '            "for(auto x : [sun, earth, moon]) x.mat().wireframe(true);",\n';
    html += '            "GG.scene().ambient(@(.5,.5,.5));",\n';
    html += '            "sun.color(Color.YELLOW);",\n';
    html += '            "earth.color((Color.SKYBLUE + Color.BLUE) / 2);",\n';
    html += '            "moon.color(Color.GRAY);",\n';
    html += '            "earthSystem.pos(@(2.2, 0.0, 0.0));",\n';
    html += '            "moonSystem.pos(@(.55, 0.0, 0.0));",\n';
    html += '            "sun.sca(@(2.0, 2.0, 2.0));",\n';
    html += '            "earth.sca(@(0.4, 0.4, 0.4));",\n';
    html += '            "moon.sca(@(0.12, 0.12, 0.12));",\n';
    html += '            "moonSystem --> earthSystem --> sunSystem --> GG.scene();",\n';
    html += '            "sun --> sunSystem; earth --> earthSystem; moon --> moonSystem;",\n';
    html += '            "GG.camera().pos(@(0, 5, 7));",\n';
    html += '            "GG.camera().lookAt(@(0, 0, 0));",\n';
    html += '            "0.0 => float angle;",\n';
    html += '            "while(true) {",\n';
    html += '            "  GG.nextFrame() => now;",\n';
    html += '            "  sunSystem.rotateY(.5 * GG.dt());",\n';
    html += '            "  earthSystem.rotateY(.7 * GG.dt());",\n';
    html += '            "  sun.rotateY(-1 * GG.dt());",\n';
    html += '            "  earth.rotateY(.4 * GG.dt());",\n';
    html += '            "  moon.rotateY(.9 * GG.dt());",\n';
    html += '            "  .08 * GG.dt() +=> angle;",\n';
    html += '            "  GG.camera().pos(@(7*Math.cos(angle), 5, 7*Math.sin(angle)));",\n';
    html += '            "  GG.camera().lookAt(@(0, 0, 0));",\n';
    html += '            "}",\n';
    html += '        ].join("\\n"));\n';
    html += '    } catch(e) {\n';
    html += '        console.log("[webchugl] Hero demo unavailable:", e.message);\n';
    html += '    }\n';
    html += '})();\n';
    html += '</script>\n';

    html += '</body>\n</html>';

    return html;
}

// ── Entry point ──────────────────────────────────────────────────────────

exports.publish = function(taffyData, opts) {
    var data = helper.prune(taffyData);
    data.sort('longname, version, since');

    var outdir = path.normalize(env.opts.destination);
    fs.mkPath(outdir);

    // Extract doclets
    var chuckClass = helper.find(data, { kind: 'class', longname: 'ChucK' })[0];
    var chuckMethods = helper.find(data, { kind: 'function', memberof: 'ChucK' });
    var chuckMembers = helper.find(data, { kind: 'member', memberof: 'ChucK' });
    var chuglNamespace = helper.find(data, { kind: 'namespace', longname: 'ChuGL' })[0];
    var chuglMethods = helper.find(data, { kind: 'function', memberof: 'ChuGL' });

    // Register links so {@link ...} references resolve
    helper.registerLink('ChucK', 'index.html#ChucK');
    chuckMethods.forEach(function(m) {
        helper.registerLink('ChucK#' + m.name, 'index.html#' + m.name);
    });
    chuckMembers.forEach(function(m) {
        helper.registerLink('ChucK#' + m.name, 'index.html#' + m.name);
    });
    helper.registerLink('ChuGL', 'index.html#ChuGL');
    helper.registerLink('ChuGL.init', 'index.html#init');
    chuglMethods.forEach(function(m) {
        helper.registerLink('ChuGL.' + m.name, 'index.html#' + m.name);
    });

    // Build and write
    var html = buildPage(chuckClass, chuckMethods, chuckMembers, chuglNamespace, chuglMethods);
    html = helper.resolveLinks(html);
    fs.writeFileSync(path.join(outdir, 'index.html'), html, 'utf8');

    // Copy static assets (JSDoc's copyFileSync takes a destination *directory*)
    var staticDir = path.join(opts.template, 'static');
    var staticFiles = fs.ls(staticDir, 3);
    staticFiles.forEach(function(fileName) {
        var toDir = fs.toDir(fileName.replace(staticDir, outdir));
        fs.mkPath(toDir);
        fs.copyFileSync(fileName, toDir);
    });
};
