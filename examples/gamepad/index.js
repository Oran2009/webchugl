import ChuGL from '../webchugl/webchugl-esm.js';

var ck = await ChuGL.init({
    canvas: document.getElementById('canvas'),
    whereIsChuGL: '../webchugl/',
});

await ck.runFile('./main.ck');
