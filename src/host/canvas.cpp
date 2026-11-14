// Canvas sizing for the web build: the canvas tracks its parent container
// rather than the browser window, with optional letterboxing.

#include <emscripten.h>

// Tracks canvas.parentElement instead of the browser window.
// clientWidth/Height is the PADDING box; sizing from it overflows the parent
// by the padding. display:none has no used value, so fall back to 0 there.
EM_JS(void, _chugl_install_js, (), {
    globalThis._chuglContentBox = function(el) {
        var cs = getComputedStyle(el);
        var w = parseFloat(cs.width), h = parseFloat(cs.height);
        if (!isFinite(w) || !isFinite(h) ||
            cs.width.indexOf('px') < 0 || cs.height.indexOf('px') < 0) {
            return { width: el.clientWidth, height: el.clientHeight };
        }
        return { width: Math.floor(w), height: Math.floor(h) };
    };
});

EM_JS(void, _chugl_setup_parent_resize_js, (), {
    var canvas = Module['canvas'];
    if (!canvas) return;
    var parent = canvas.parentElement;
    if (!parent) return;

    var glfwWindow = Module['glfwGetWindow'](canvas);
    if (glfwWindow == null || typeof GLFW3 === 'undefined') return;
    var ctx = GLFW3.fWindowContexts[glfwWindow];
    if (!ctx || !ctx.fCanvasResize) return;

    // Suppresses the notification only: emglfw3w_set_size() writes inline px CSS
    // before onSizeChanged is consulted, so GLFW still sizes the canvas.
    ctx.fCanvasResize.onSizeChanged = function() {};

    // display:block avoids the inline element's baseline gap adding height.
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';

    var contentBoxSize = globalThis._chuglContentBox;

    ctx.fCanvasResize.computeSize = function() {
        var p = canvas.parentElement;
        return p ? contentBoxSize(p)
                 : { width: window.innerWidth, height: window.innerHeight };
    };

    // Watches the parent captured at setup time; re-parenting needs another
    // chugl_setup_parent_resize() call or the observer goes stale.
    if (canvas._chuglParentObserver) {
        canvas._chuglParentObserver.disconnect();
    }
    function triggerGLFWResize() {
        var size = ctx.fCanvasResize.computeSize();
        GLFW3.onWindowResize(glfwWindow, size.width, size.height);
    }

    // computeSize(), not entry.contentBoxSize: letterbox replaces computeSize,
    // and reading the entry would bypass that and break aspect-ratio mode.
    var lastW = 0, lastH = 0;
    canvas._chuglParentObserver = new ResizeObserver(function() {
        var size = ctx.fCanvasResize.computeSize();
        if (size.width === lastW && size.height === lastH) return;
        lastW = size.width;
        lastH = size.height;
        triggerGLFWResize();
    });
    canvas._chuglParentObserver.observe(parent);

    triggerGLFWResize();
});

extern "C" EMSCRIPTEN_KEEPALIVE
void chugl_setup_parent_resize()
{
    _chugl_install_js();
    _chugl_setup_parent_resize_js();
}

// Called from app.cpp's SG_COMMAND_WINDOW_SIZE_LIMITS handler. Centers via an
// owned wrapper <div> so host CSS on the parent (e.g. .hidden) is never touched.
EM_JS(void, _chugl_setup_letterbox_js, (double ar_x, double ar_y), {
    var canvas = Module['canvas'];
    if (!canvas) return;
    var hasAspect = (ar_x > 0 && ar_y > 0);

    if (hasAspect) {
        var wrapper = canvas._chuglWrapper;
        if (!wrapper) {
            wrapper = document.createElement('div');
            canvas._chuglWrapper = wrapper;
            var parent = canvas.parentElement;
            if (parent) {
                parent.insertBefore(wrapper, canvas);
                wrapper.appendChild(canvas);
            }
        }
        wrapper.style.display = 'flex';
        wrapper.style.justifyContent = 'center';
        wrapper.style.alignItems = 'center';
        wrapper.style.width = '100%';
        wrapper.style.height = '100%';
    } else {
        var wrapper = canvas._chuglWrapper;
        if (wrapper && wrapper.parentElement) {
            wrapper.parentElement.insertBefore(canvas, wrapper);
            wrapper.parentElement.removeChild(wrapper);
        }
        canvas._chuglWrapper = null;
    }

    var glfwWindow = Module['glfwGetWindow'](canvas);
    if (glfwWindow != null && typeof GLFW3 !== 'undefined') {
        var ctx = GLFW3.fWindowContexts[glfwWindow];
        if (ctx && ctx.fCanvasResize) {
            var contentBoxSize = globalThis._chuglContentBox;
            if (hasAspect) {
                var ar = ar_x / ar_y;
                ctx.fCanvasResize.computeSize = function() {
                    var w = canvas._chuglWrapper;
                    var p = w ? w.parentElement : canvas.parentElement;
                    var avail = p ? contentBoxSize(p)
                                  : {width: window.innerWidth,
                                     height: window.innerHeight};
                    var vw = avail.width, vh = avail.height;
                    if (vw / vh > ar) {
                        return {width: Math.round(vh * ar), height: vh};
                    } else {
                        return {width: vw, height: Math.round(vw / ar)};
                    }
                };
            } else {
                ctx.fCanvasResize.computeSize = function() {
                    var p = canvas.parentElement;
                    return p ? contentBoxSize(p)
                             : {width: window.innerWidth,
                                height: window.innerHeight};
                };
            }
            var size = ctx.fCanvasResize.computeSize();
            GLFW3.onWindowResize(glfwWindow, size.width, size.height);
        }
    }
});

extern "C" void _chugl_setup_letterbox(double ar_x, double ar_y)
{
    _chugl_install_js();
    _chugl_setup_letterbox_js(ar_x, ar_y);
}
