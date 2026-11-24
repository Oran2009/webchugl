#include <emscripten.h>

// Fit the canvas to its container; aspect is width/height, 0 for no letterbox.
EM_JS(void, _chugl_fit_canvas_js, (double aspect), {
    var canvas = Module['canvas'];
    if (!canvas) return;

    // Port overwrites canvas width/height each resize, so constrain a wrapper.
    if (aspect && !canvas._chuglLetterbox) {
        var parent = canvas.parentElement;
        if (!parent) return;
        var outer = document.createElement('div');
        Object.assign(outer.style, {
            width: '100%', height: '100%', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            containerType: 'size',
        });
        var inner = document.createElement('div');
        outer.appendChild(inner);
        parent.insertBefore(outer, canvas);
        inner.appendChild(canvas);
        canvas._chuglLetterbox = inner;
    }

    var letterbox = canvas._chuglLetterbox;
    if (letterbox) {
        Object.assign(letterbox.style, {
            // Per axis, not aspect-ratio: deriving one from the other loses a pixel.
            width: aspect ? 'min(100cqw, calc(100cqh * ' + aspect + '))' : '100%',
            height: aspect ? 'min(100cqh, calc(100cqw / ' + aspect + '))' : '100%',
            // Flex auto min-size would let the canvas inflate the box that sizes it.
            minWidth: 0, minHeight: 0, flex: 'none', overflow: 'hidden',
        });
    }

    var target = letterbox || canvas.parentElement;
    if (!target) return;
    // glfwMakeCanvasResizable takes a selector; ids must be unique per page.
    if (!target.id) {
        globalThis._chuglContainerSeq = (globalThis._chuglContainerSeq || 0) + 1;
        target.id = 'chugl-container-' + globalThis._chuglContainerSeq;
    }
    Module['glfwMakeCanvasResizable'](canvas, '#' + target.id, null);
});

extern "C" void chugl_fit_canvas(double aspect_x, double aspect_y)
{
    _chugl_fit_canvas_js((aspect_x > 0 && aspect_y > 0) ? aspect_x / aspect_y : 0);
}
