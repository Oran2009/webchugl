# WebChuGL

[![](https://data.jsdelivr.com/v1/package/npm/webchugl/badge)](https://www.jsdelivr.com/package/npm/webchugl)

[site](https://chuck.stanford.edu/webchugl/) | [docs](https://chuck.stanford.edu/webchugl/docs/) | [npm](https://www.npmjs.com/package/webchugl)

WebChuGL brings [ChuGL](http://chuck.stanford.edu/chugl/), the real-time graphics framework for the [ChucK](https://chuck.stanford.edu/) programming language, to the web browser!
ChuGL's C++ source code has been compiled with [Emscripten](https://emscripten.org) to WebAssembly (WASM) to render via the WebGPU API and run audio through an [AudioWorkletNode](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletNode).

WebChuGL builds on [WebChucK](https://chuck.cs.princeton.edu/webchuck/) by adding ChuGL’s scenegraph, materials, textures, shaders, post-processing, and the full GGen (graphics generator) ecosystem — all tightly synchronized to ChucK’s strongly-timed audio engine.

To learn more about WebChuGL and what it can do, check out [https://chuck.stanford.edu/webchugl/](https://chuck.stanford.edu/webchugl/).

## Getting Started

### NPM

Install WebChuGL via [npm](https://www.npmjs.com/package/webchugl):

```
npm install webchugl
```

```js
import ChuGL from 'webchugl';

// Initialize WebChuGL with a canvas
const ck = await ChuGL.init({
    canvas: document.getElementById('canvas'),
});

// Run ChucK + ChuGL code
ck.runCode(`
    GPlane plane --> GG.scene();
    while (true) GG.nextFrame() => now;
`);
```

### CDN

You can also embed WebChuGL as a JavaScript module into your `index.html`.

```html
<html>
  <head>
    <script type="module" defer>
      import ChuGL from 'https://cdn.jsdelivr.net/npm/webchugl/+esm';

      let ck; // global variable

      document.getElementById('action').addEventListener('click', async () => {
        // Initialize WebChuGL
        if (ck === undefined) {
          ck = await ChuGL.init({
            canvas: document.getElementById('canvas'),
          });
        }
        // Run ChucK + ChuGL code
        ck.runCode(`
          GPlane plane --> GG.scene();
          while (true) GG.nextFrame() => now;
        `);
      });
    </script>
  </head>
  <body>
    <canvas id="canvas"></canvas>
    <button id="action">Start</button>
  </body>
</html>
```

`ck` contains the ChucK Virtual Machine for running code, loading files, syncing global variables, and more! Read the [documentation](https://chuck.stanford.edu/webchugl/docs/) for the full API reference.

## Documentation

WebChuGL full documentation and API reference: [here](https://chuck.stanford.edu/webchugl/docs/)
