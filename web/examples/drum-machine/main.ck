// Drum Machine Example: HTML step sequencer -> ChucK, with persistent storage

global int pattern_kick[16];
global int pattern_snare[16];
global int pattern_hihat[16];
global int pattern_clap[16];
global float bpm;
global int currentStep;
global int samplesReady;
global Event step;
global Event samplesLoaded;

120.0 => bpm;
0 => currentStep;

while (samplesReady == 0) {
    GG.nextFrame() => now;
}

SndBuf kickBuf => dac;
SndBuf snareBuf => dac;
SndBuf hihatBuf => dac;
SndBuf clapBuf => dac;

"/audio/kick.wav" => kickBuf.read;
"/audio/snare.wav" => snareBuf.read;
"/audio/hihat.wav" => hihatBuf.read;
"/audio/clap.wav" => clapBuf.read;

kickBuf.samples() => kickBuf.pos;
snareBuf.samples() => snareBuf.pos;
hihatBuf.samples() => hihatBuf.pos;
clapBuf.samples() => clapBuf.pos;

0.8 => kickBuf.gain;
0.6 => snareBuf.gain;
0.4 => hihatBuf.gain;
0.5 => clapBuf.gain;

GText titleText --> GG.scene();
0.05 => titleText.sca;
@(0.0, 1.5, 0.0) => titleText.pos;
Color.WHITE => titleText.color;
"Drum Machine" => titleText.text;

GText stepText --> GG.scene();
0.04 => stepText.sca;
@(0.0, 1.0, 0.0) => stepText.pos;
Color.YELLOW => stepText.color;

GCircle stepDots[16];
for (0 => int i; i < 16; i++) {
    stepDots[i] --> GG.scene();
    0.04 => stepDots[i].sca;
    Std.scalef(i, 0, 15, -2.0, 2.0) => float x;
    @(x, 0.0, 0.0) => stepDots[i].pos;
    @(0.2, 0.2, 0.3) => stepDots[i].color;
}

while (true) {
    (60.0 / bpm / 4.0)::second => dur stepDur;

    if (pattern_kick[currentStep])  0 => kickBuf.pos;
    if (pattern_snare[currentStep]) 0 => snareBuf.pos;
    if (pattern_hihat[currentStep]) 0 => hihatBuf.pos;
    if (pattern_clap[currentStep])  0 => clapBuf.pos;

    for (0 => int i; i < 16; i++) {
        if (i == currentStep) {
            @(1.0, 1.0, 1.0) => stepDots[i].color;
            0.07 => stepDots[i].sca;
        } else {
            @(0.2, 0.2, 0.3) => stepDots[i].color;
            0.04 => stepDots[i].sca;
        }
    }

    "Step " + (currentStep + 1) + "/16 | " + Std.ftoa(bpm, 0) + " BPM" => stepText.text;

    step.broadcast();

    stepDur => now;

    (currentStep + 1) % 16 => currentStep;

    GG.nextFrame() => now;
}
