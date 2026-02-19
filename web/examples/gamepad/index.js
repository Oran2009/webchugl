import ChuGL from '../../src/webchugl-esm.js';

var ck = await ChuGL.init({
    canvas: document.getElementById('canvas'),
    whereIsChuGL: '../../src/',
});

await ck.runFile('./main.ck');
