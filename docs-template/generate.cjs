'use strict';

var fs = require('fs');
var path = require('path');

// ── TypeDoc reflection kinds ─────────────────────────────────────────────

var KIND = {
    VARIABLE: 32,
    INTERFACE: 256,
    PROPERTY: 1024,
    METHOD: 2048,
};

// ── Standalone types to document ─────────────────────────────────────────

var DOCUMENTED_TYPES = [
    'ChuGLConfig', 'AudioConfig', 'ShredInfo',
    'GlobalVariableInfo', 'RunResult', 'ReplaceResult',
];

// ── Method grouping ──────────────────────────────────────────────────────

var METHOD_GROUPS = [
    { title: 'Code Execution',      methods: ['runCode', 'runFile', 'runFileWithArgs', 'runZip'] },
    { title: 'Shred Management',    methods: ['replaceCode', 'replaceFile', 'replaceFileWithArgs', 'removeLastCode', 'removeShred', 'isShredActive'] },
    { title: 'Global Variables',    methods: ['setInt', 'setFloat', 'setString', 'getInt', 'getFloat', 'getString', 'setIntArray', 'getIntArray', 'setIntArrayValue', 'getIntArrayValue', 'setAssocIntArrayValue', 'getAssocIntArrayValue', 'setFloatArray', 'getFloatArray', 'setFloatArrayValue', 'getFloatArrayValue', 'setAssocFloatArrayValue', 'getAssocFloatArrayValue'] },
    { title: 'Device Access',       methods: ['initMidi', 'requestMidi', 'requestMicrophone', 'requestWebcam'] },
    { title: 'Audio',               methods: ['getSampleRate', 'connect', 'disconnect'] },
    { title: 'Events',              methods: ['signalEvent', 'broadcastEvent', 'listenForEventOnce', 'stopListeningForEvent', 'startListeningForEvent'] },
    { title: 'VM',                  methods: ['getCurrentTime', 'fps', 'dt', 'frameCount', 'isRunning', 'now', 'getActiveShreds', 'getLastError', 'getGlobalVariables', 'setParamInt', 'getParamInt', 'setParamFloat', 'getParamFloat', 'setParamString', 'getParamString', 'clearChuckInstance', 'clearGlobals', 'reset', 'destroy'] },
    { title: 'Virtual Filesystem',  methods: ['createFile', 'removeFile', 'fileExists', 'listFiles', 'loadFile', 'loadFiles', 'loadZip', 'loadAudio', 'loadVideo'] },
    { title: 'Persistent Storage',  methods: ['save', 'load', 'delete', 'listKeys'] },
    { title: 'ChuGins & Packages',  methods: ['loadChugin', 'getLoadedChugins', 'loadPackage'] },
];

// ── HTML helpers ─────────────────────────────────────────────────────────

function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// ── TypeDoc JSON helpers ─────────────────────────────────────────────────

function renderComment(parts) {
    if (!parts || !parts.length) return '';
    var html = '';
    for (var i = 0; i < parts.length; i++) {
        var part = parts[i];
        if (part.kind === 'text') {
            html += part.text
                .replace(/\r\n/g, '\n')
                .replace(/\n\n/g, '</p><p>')
                .replace(/`([^`]+)`/g, '<code>$1</code>')
                .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
                .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
        } else if (part.kind === 'code') {
            var code = part.text;
            if (code.startsWith('```')) {
                var lines = code.split('\n');
                var lang = lines[0].replace(/^```/, '').trim() || 'javascript';
                html += '<pre><code class="language-' + esc(lang) + '">' + esc(lines.slice(1, -1).join('\n')) + '</code></pre>';
            } else if (code.startsWith('`') && code.endsWith('`')) {
                html += '<code>' + esc(code.slice(1, -1)) + '</code>';
            } else {
                html += '<code>' + esc(code) + '</code>';
            }
        } else if (part.kind === 'inline-tag' && part.tag === '@link') {
            var text = part.text || '';
            html += '<a href="#' + esc(text.split('.').pop()) + '"><code>' + esc(text) + '</code></a>';
        }
    }
    return html;
}

function typeToString(type) {
    if (!type) return '';
    switch (type.type) {
        case 'intrinsic': return type.name;
        case 'literal':   return type.value === null ? 'null' : String(type.value);
        case 'reference': {
            var name = type.name;
            if (type.typeArguments && type.typeArguments.length)
                name += '<' + type.typeArguments.map(typeToString).join(', ') + '>';
            return name;
        }
        case 'union':        return type.types.map(typeToString).join(' | ');
        case 'intersection': return type.types.map(typeToString).join(' & ');
        case 'array':        return typeToString(type.elementType) + '[]';
        case 'reflection': {
            var decl = type.declaration;
            if (decl && decl.signatures && decl.signatures.length) {
                var sig = decl.signatures[0];
                var params = (sig.parameters || []).map(function (p) {
                    return p.name + ': ' + typeToString(p.type);
                }).join(', ');
                return '(' + params + ') => ' + typeToString(sig.type);
            }
            return 'object';
        }
        default: return type.name || '';
    }
}

function findChild(parent, name, kind) {
    if (!parent || !parent.children) return null;
    for (var i = 0; i < parent.children.length; i++) {
        var c = parent.children[i];
        if (c.name === name && (!kind || c.kind === kind)) return c;
    }
    return null;
}

function getBlockTag(comment, tag) {
    if (!comment || !comment.blockTags) return null;
    for (var i = 0; i < comment.blockTags.length; i++) {
        if (comment.blockTags[i].tag === tag) return comment.blockTags[i];
    }
    return null;
}

function getBlockTags(comment, tag) {
    if (!comment || !comment.blockTags) return [];
    return comment.blockTags.filter(function (t) { return t.tag === tag; });
}

// ── Extract info from TypeDoc reflections ────────────────────────────────

function extractMethodInfo(member) {
    if (!member.signatures || !member.signatures.length) return null;
    var sig = member.signatures[0];
    var comment = sig.comment || {};

    var params = (sig.parameters || []).map(function (p) {
        return {
            name: p.name,
            type: typeToString(p.type),
            description: p.comment ? renderComment(p.comment.summary) : '',
            optional: !!(p.flags && p.flags.isOptional),
            defaultValue: p.defaultValue,
        };
    });

    var returnsTag = getBlockTag(comment, '@returns');
    var examples = getBlockTags(comment, '@example').map(function (t) {
        return renderComment(t.content);
    });

    return {
        name: member.name,
        description: comment.summary ? renderComment(comment.summary) : '',
        params: params,
        returnType: typeToString(sig.type),
        returnsDescription: returnsTag ? renderComment(returnsTag.content) : null,
        examples: examples,
    };
}

function extractPropertyInfo(member) {
    var comment = member.comment || {};
    return {
        name: member.name,
        description: comment.summary ? renderComment(comment.summary) : '',
        type: typeToString(member.type),
    };
}

function extractInterfaceProperties(iface, sourceOrder) {
    if (!iface || !iface.children) return [];
    var byName = {};
    iface.children.forEach(function (child) {
        if (child.kind !== KIND.PROPERTY) return;
        var comment = child.comment || {};
        byName[child.name] = {
            name: child.name,
            description: comment.summary ? renderComment(comment.summary) : '',
            type: typeToString(child.type),
            optional: !!(child.flags && child.flags.isOptional),
        };
    });
    if (sourceOrder) {
        var ordered = [];
        sourceOrder.forEach(function (name) {
            if (byName[name]) ordered.push(byName[name]);
        });
        return ordered;
    }
    return iface.children
        .filter(function (c) { return c.kind === KIND.PROPERTY; })
        .map(function (c) { return byName[c.name]; });
}

function extractChuGLMethod(chuglVar, methodName) {
    if (!chuglVar) return null;
    var typeLiteral = chuglVar.type && chuglVar.type.declaration;
    if (!typeLiteral || !typeLiteral.children) return null;
    var prop = findChild(typeLiteral, methodName);
    if (!prop) return null;

    var comment = prop.comment || {};
    var sig = null;
    if (prop.type && prop.type.declaration && prop.type.declaration.signatures)
        sig = prop.type.declaration.signatures[0];

    var params = [];
    var returnType = '';
    if (sig) {
        params = (sig.parameters || []).map(function (p) {
            return {
                name: p.name,
                type: typeToString(p.type),
                description: p.comment ? renderComment(p.comment.summary) : '',
                optional: !!(p.flags && p.flags.isOptional),
            };
        });
        returnType = typeToString(sig.type);
    }

    var returnsTag = getBlockTag(comment, '@returns');
    var examples = getBlockTags(comment, '@example').map(function (t) {
        return renderComment(t.content);
    });

    return {
        name: methodName,
        description: comment.summary ? renderComment(comment.summary) : '',
        params: params,
        returnType: returnType,
        returnsDescription: returnsTag ? renderComment(returnsTag.content) : null,
        examples: examples,
        configProperties: [],
    };
}

// ── Render components ────────────────────────────────────────────────────

function renderMethod(method) {
    var params = method.params || [];
    var sigParams = params.map(function (p) { return p.optional ? p.name + '?' : p.name; });
    var sig = method.name + '(' + sigParams.join(', ') + ')';

    var html = '<div class="method" id="' + esc(method.name) + '">';
    html += '<h4 class="method-sig"><code>' + esc(sig) + '</code>';
    if (method.returnType)
        html += ' <span class="arrow">&rarr;</span> <span class="ret-type">' + esc(method.returnType) + '</span>';
    html += '</h4>';

    if (method.description)
        html += '<div class="method-desc"><p>' + method.description + '</p></div>';

    if (params.length > 0) {
        html += '<table class="params-table"><thead><tr><th scope="col">Parameter</th><th scope="col">Type</th><th scope="col">Description</th></tr></thead><tbody>';
        params.forEach(function (p) {
            html += '<tr><td><code>' + esc(p.name) + '</code>';
            if (p.optional) html += ' <span class="opt">optional</span>';
            if (p.defaultValue != null) html += ' <span class="def">= ' + esc(String(p.defaultValue)) + '</span>';
            html += '</td><td><code class="type">' + esc(p.type) + '</code></td><td>' + (p.description || '') + '</td></tr>';
        });
        html += '</tbody></table>';
    }

    if (method.configProperties && method.configProperties.length > 0) {
        html += '<h5>Config Properties</h5>';
        html += '<table class="params-table"><thead><tr><th scope="col">Property</th><th scope="col">Type</th><th scope="col">Description</th></tr></thead><tbody>';
        method.configProperties.forEach(function (p) {
            html += '<tr><td><code>' + esc(p.name) + '</code>';
            if (p.optional) html += ' <span class="opt">optional</span>';
            html += '</td><td><code class="type">' + esc(p.type) + '</code></td><td>' + (p.description || '') + '</td></tr>';
        });
        html += '</tbody></table>';
    }

    if (method.returnsDescription)
        html += '<p class="returns"><span class="label">Returns:</span> ' + method.returnsDescription + '</p>';

    method.examples.forEach(function (ex) { html += ex; });
    html += '</div>';
    return html;
}

function renderMember(member) {
    var html = '<div class="method" id="' + esc(member.name) + '">';
    html += '<h4 class="method-sig"><code>' + esc(member.name) + '</code>';
    if (member.type) html += ' <span class="ret-type">: ' + esc(member.type) + '</span>';
    html += ' <span class="badge">property</span></h4>';
    if (member.description) html += '<div class="method-desc">' + member.description + '</div>';
    html += '</div>';
    return html;
}

function renderToc(items) {
    return '<div class="method-toc">' +
        items.map(function (m) { return '<a href="#' + esc(m.name) + '">' + esc(m.name) + '</a>'; }).join('') +
        '</div>';
}

function renderGroup(title, items, renderFn) {
    var id = slugify(title);
    return '<details class="group" id="' + esc(id) + '" open>\n' +
        '<summary class="group-title">' + esc(title) + ' <span class="group-count">' + items.length + '</span></summary>\n' +
        '<div class="details-content" style="grid-template-rows:1fr"><div class="details-inner">\n' +
        renderToc(items) +
        items.map(renderFn).join('') +
        '</div></div>\n</details>\n';
}

// ── Render standalone type/interface ─────────────────────────────────────

function renderTypeInterface(iface) {
    var comment = iface.comment || {};
    var html = '<div class="method" id="' + esc(iface.name) + '">';
    html += '<h4 class="method-sig"><code>' + esc(iface.name) + '</code> <span class="badge">interface</span></h4>';
    if (comment.summary)
        html += '<div class="method-desc"><p>' + renderComment(comment.summary) + '</p></div>';

    var props = (iface.children || []).filter(function (c) {
        return c.kind === KIND.PROPERTY || c.kind === KIND.METHOD;
    });
    if (props.length > 0) {
        html += '<table class="params-table"><thead><tr><th scope="col">Property</th><th scope="col">Type</th><th scope="col">Description</th></tr></thead><tbody>';
        props.forEach(function (p) {
            var pType = '';
            if (p.kind === KIND.METHOD && p.signatures && p.signatures.length) {
                pType = '() => ' + typeToString(p.signatures[0].type);
            } else {
                pType = typeToString(p.type);
            }
            var pComment = p.comment || (p.signatures && p.signatures[0] && p.signatures[0].comment) || {};
            var desc = pComment.summary ? renderComment(pComment.summary) : '';
            html += '<tr><td><code>' + esc(p.name) + '</code>';
            if (p.flags && p.flags.isOptional) html += ' <span class="opt">optional</span>';
            html += '</td><td><code class="type">' + esc(pType) + '</code></td><td>' + desc + '</td></tr>';
        });
        html += '</tbody></table>';
    }
    html += '</div>';
    return html;
}

// ── Build page sections ──────────────────────────────────────────────────

function buildChuGLContent(chuglDesc, chuglMethods) {
    var html = '';
    if (chuglDesc) html += '<div class="section-desc"><p>' + chuglDesc + '</p></div>';
    chuglMethods.forEach(function (m) { html += renderMethod(m); });
    return html;
}

function buildChucKContent(chuckDesc, chuckMethods, chuckMembers) {
    var html = '';
    if (chuckDesc) html += '<div class="section-desc"><p>' + chuckDesc + '</p></div>';

    if (chuckMembers.length > 0)
        html += renderGroup('Properties', chuckMembers, renderMember);

    var usedMethods = {};
    METHOD_GROUPS.forEach(function (group) {
        var items = group.methods
            .map(function (name) { return chuckMethods.filter(function (m) { return m.name === name; })[0]; })
            .filter(Boolean);
        if (items.length === 0) return;
        items.forEach(function (m) { usedMethods[m.name] = true; });
        html += renderGroup(group.title, items, renderMethod);
    });

    var ungrouped = chuckMethods.filter(function (m) { return !usedMethods[m.name]; });
    if (ungrouped.length > 0)
        html += renderGroup('Other', ungrouped, renderMethod);

    return html;
}

function buildSidebarGroups(chuckMethods, chuckMembers) {
    var html = '';
    if (chuckMembers.length > 0)
        html += '<a href="#properties" class="toc-sub">Properties</a>\n';
    METHOD_GROUPS.forEach(function (group) {
        var hasItems = group.methods.some(function (name) {
            return chuckMethods.some(function (m) { return m.name === name; });
        });
        if (hasItems)
            html += '<a href="#' + slugify(group.title) + '" class="toc-sub">' + esc(group.title) + '</a>\n';
    });
    return html;
}

// ── Main ─────────────────────────────────────────────────────────────────

function main() {
    var modelPath = process.argv[2] || 'docs-model.json';
    var outDir = process.argv[3] || 'web/docs';

    if (!fs.existsSync(modelPath)) {
        console.error('Error: TypeDoc model not found at ' + modelPath);
        console.error('Run `npx typedoc` first to generate docs-model.json');
        process.exit(1);
    }

    var data = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
    var template = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');

    // ── Extract from TypeDoc model ──
    var chuckModule = findChild(data, 'types/chuck');
    var esmModule = findChild(data, 'webchugl-esm');

    var chuckIface = chuckModule ? findChild(chuckModule, 'ChucK', KIND.INTERFACE) : null;
    var chuckDesc = '';
    var chuckMethods = [];
    var chuckMembers = [];

    if (chuckIface) {
        if (chuckIface.comment && chuckIface.comment.summary)
            chuckDesc = renderComment(chuckIface.comment.summary);
        (chuckIface.children || []).forEach(function (child) {
            if (child.kind === KIND.METHOD) {
                var info = extractMethodInfo(child);
                if (info) chuckMethods.push(info);
            } else if (child.kind === KIND.PROPERTY) {
                chuckMembers.push(extractPropertyInfo(child));
            }
        });
    }

    var chuglVar = esmModule ? findChild(esmModule, 'ChuGL', KIND.VARIABLE) : null;
    var chuglDesc = '';
    var chuglMethods = [];

    if (chuglVar) {
        if (chuglVar.comment && chuglVar.comment.summary)
            chuglDesc = renderComment(chuglVar.comment.summary);
        var initMethod = extractChuGLMethod(chuglVar, 'init');
        if (initMethod) {
            // Expand ChuGLConfig properties inline
            var chuglConfigIface = findChild(esmModule, 'ChuGLConfig', KIND.INTERFACE);
            if (chuglConfigIface) {
                var sourceOrder = ['canvas', 'whereIsChuGL', 'chugins', 'serviceWorker', 'audioConfig', 'onProgress', 'onError', 'onReady'];
                initMethod.configProperties = extractInterfaceProperties(chuglConfigIface, sourceOrder);
            }
            chuglMethods.push(initMethod);
        }
    }

    // ── Extract standalone types ──
    var typeInterfaces = [];
    DOCUMENTED_TYPES.forEach(function (name) {
        var iface = findChild(chuckModule, name, KIND.INTERFACE)
                 || findChild(esmModule, name, KIND.INTERFACE);
        if (iface) typeInterfaces.push(iface);
    });

    var typesHtml = typeInterfaces.map(renderTypeInterface).join('');
    var typesSidebarHtml = typeInterfaces.map(function (t) {
        return '<a href="#' + esc(t.name) + '" class="toc-sub">' + esc(t.name) + '</a>';
    }).join('\n');

    // ── Inject into template ──
    var html = template
        .replace('<!-- CHUGL_CONTENT -->', buildChuGLContent(chuglDesc, chuglMethods))
        .replace('<!-- CHUCK_CONTENT -->', buildChucKContent(chuckDesc, chuckMethods, chuckMembers))
        .replace('<!-- SIDEBAR_GROUPS -->', buildSidebarGroups(chuckMethods, chuckMembers))
        .replace('<!-- TYPES_CONTENT -->', typesHtml)
        .replace('<!-- SIDEBAR_TYPES -->', typesSidebarHtml);

    // ── Write output ──
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');

    var templateDir = path.join(__dirname, 'static');
    if (fs.existsSync(templateDir)) {
        fs.readdirSync(templateDir).forEach(function (file) {
            fs.copyFileSync(path.join(templateDir, file), path.join(outDir, file));
        });
    }

    console.log('Documentation generated at ' + path.join(outDir, 'index.html'));
    console.log('  ChucK methods: ' + chuckMethods.length + ', properties: ' + chuckMembers.length + ', ChuGL methods: ' + chuglMethods.length);
}

main();
