import ChuGL from 'https://cdn.jsdelivr.net/npm/webchugl/+esm';

var ck = await ChuGL.init({
    canvas: document.getElementById('canvas'),
    whereIsChuGL: '../../src/',
});

await ck.runFile('./main.ck');
