import ChuGL from '../webchugl/webchugl-esm.js';

var ck = await ChuGL.init({
    canvas: document.getElementById('canvas'),
    whereIsChuGL: '../webchugl/',
});

// Initialize MIDI if available
if (navigator.requestMIDIAccess) {
    try {
        var access = await navigator.requestMIDIAccess();
        ck.initMidi(access);
        console.log('[MIDI] Initialized with', access.inputs.size, 'input(s)');
    } catch (e) {
        console.log('[MIDI] Not available:', e.message);
    }
}

await ck.runFile('./main.ck');
