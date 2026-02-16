// HTML UI Example: DOM controls driving ChucK synth parameters

global float frequency;
global float gain;
global float filterCutoff;
global float reverbMix;
global int waveform;

440.0 => frequency;
0.2 => gain;
2000.0 => filterCutoff;
0.1 => reverbMix;
2 => waveform;

SinOsc sin => Gain oscMix => LPF lpf => NRev rev => dac;
TriOsc tri => oscMix;
SawOsc saw => oscMix;
SqrOsc sqr => oscMix;

0 => sin.gain => tri.gain => saw.gain => sqr.gain;
3 => lpf.Q;

440.0 => float sFreq;
0.2 => float sGain;
2000.0 => float sFilter;
0.1 => float sRev;

// Visuals
GCircle circle --> GG.scene();
0.5 => circle.sca;

GText label --> GG.scene();
0.04 => label.sca;
@(0.0, -1.8, 0.0) => label.pos;
@(0.6, 0.6, 0.6) => label.color;

["Sine", "Triangle", "Saw", "Square"] @=> string waveNames[];

while (true) {
    GG.nextFrame() => now;

    sFreq + (frequency - sFreq) * 0.08 => sFreq;
    sGain + (gain - sGain) * 0.12 => sGain;
    sFilter + (filterCutoff - sFilter) * 0.08 => sFilter;
    sRev + (reverbMix - sRev) * 0.1 => sRev;

    sFreq => sin.freq => tri.freq => saw.freq => sqr.freq;
    sFilter => lpf.freq;
    sRev => rev.mix;

    (waveform == 0 ? sGain : 0.0) => sin.gain;
    (waveform == 1 ? sGain : 0.0) => tri.gain;
    (waveform == 2 ? sGain : 0.0) => saw.gain;
    (waveform == 3 ? sGain : 0.0) => sqr.gain;

    0.3 + sGain * 2.0 => circle.sca;
    Std.scalef(sFreq, 50, 2000, 0, 1) => float hue;
    @(hue, 0.4, 1.0 - hue) => circle.color;

    waveNames[waveform] + " | " + Std.ftoa(sFreq, 0) + " Hz" => label.text;
}
