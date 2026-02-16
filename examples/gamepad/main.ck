// Gamepad Example: Synth Controller
// Connect a gamepad to control a synthesizer.
// Left stick: pitch + filter | Right stick: pan + reverb
// Triggers: volume | Face buttons: waveform | Bumpers: octave

SinOsc osc1 => LPF lpf => Pan2 pan => NRev rev => dac;
0 => osc1.gain;
2000 => lpf.freq;
3 => lpf.Q;
0.1 => rev.mix;

TriOsc osc2 => blackhole;
SawOsc osc3 => blackhole;
SqrOsc osc4 => blackhole;

0 => int activeOsc; // 0=sin, 1=tri, 2=saw, 3=sqr
0 => int octave;    // -2 to +2
440.0 => float baseFreq;
0.0 => float smoothFreq;
0.0 => float smoothGain;
0.0 => float smoothFilter;

GG.camera().orthographic();
GG.camera().viewSize(5);

GText title --> GG.scene();
"Connect a gamepad and press any button..." => title.text;
0.06 => title.sca;
@(0.0, 2.2, 0.0) => title.pos;
Color.WHITE => title.color;

GText paramText --> GG.scene();
"" => paramText.text;
0.035 => paramText.sca;
@(0.0, -2.0, 0.0) => paramText.pos;
@(0.7, 0.7, 0.7) => paramText.color;

GText waveLabel --> GG.scene();
"" => waveLabel.text;
0.04 => waveLabel.sca;
@(0.0, 1.8, 0.0) => waveLabel.pos;
Color.YELLOW => waveLabel.color;

GCircle cursor --> GG.scene();
0.15 => cursor.sca;
@(0.2, 0.8, 1.0) => cursor.color;

for (0 => int i; i < 9; i++) {
    GLines hLine --> GG.scene();
    GLines vLine --> GG.scene();
    @(0.12, 0.12, 0.12) => vec3 gridColor;
    hLine.color(gridColor);
    vLine.color(gridColor);
    0.001 => hLine.width;
    0.001 => vLine.width;

    Std.scalef(i, 0, 8, -2.0, 2.0) => float p;
    hLine.positions([@(-2.5, p), @(2.5, p)]);
    vLine.positions([@(p, -2.5), @(p, 2.5)]);
}

["Sine", "Triangle", "Saw", "Square"] @=> string waveNames[];

fun void switchOsc(int idx) {
    if (activeOsc == 0) osc1 =< lpf;
    else if (activeOsc == 1) osc2 =< lpf;
    else if (activeOsc == 2) osc3 =< lpf;
    else if (activeOsc == 3) osc4 =< lpf;

    if (idx == 0) { osc1 =< blackhole; osc1 => lpf; }
    else if (idx == 1) { osc2 =< blackhole; osc2 => lpf; }
    else if (idx == 2) { osc3 =< blackhole; osc3 => lpf; }
    else if (idx == 3) { osc4 =< blackhole; osc4 => lpf; }

    if (activeOsc == 0) osc1 => blackhole;
    else if (activeOsc == 1) osc2 => blackhole;
    else if (activeOsc == 2) osc3 => blackhole;
    else if (activeOsc == 3) osc4 => blackhole;

    idx => activeOsc;
}

osc1 => lpf;

while (true) {
    GG.nextFrame() => now;

    if (!Gamepad.available(0)) {
        "Connect a gamepad and press any button..." => title.text;
        "" => paramText.text;
        "" => waveLabel.text;
        continue;
    }

    Gamepad.name(0) => title.text;

    if (Gamepad.buttonDown(0, Gamepad.BUTTON_A)) switchOsc(0);
    if (Gamepad.buttonDown(0, Gamepad.BUTTON_B)) switchOsc(1);
    if (Gamepad.buttonDown(0, Gamepad.BUTTON_X)) switchOsc(2);
    if (Gamepad.buttonDown(0, Gamepad.BUTTON_Y)) switchOsc(3);

    if (Gamepad.buttonDown(0, Gamepad.BUTTON_LEFT_BUMPER) && octave > -2)
        octave - 1 => octave;
    if (Gamepad.buttonDown(0, Gamepad.BUTTON_RIGHT_BUMPER) && octave < 2)
        octave + 1 => octave;

    Gamepad.axis(0, Gamepad.AXIS_LEFT_X) => float lx;
    Gamepad.axis(0, Gamepad.AXIS_LEFT_Y) => float ly;
    Std.scalef(lx, -1, 1, 200, 2000) => baseFreq;
    baseFreq * Math.pow(2, octave) => float targetFreq;

    Std.scalef(-ly, -1, 1, 100, 8000) => float targetFilter;

    Gamepad.axis(0, Gamepad.AXIS_RIGHT_X) => float rx;
    rx => pan.pan;

    Gamepad.axis(0, Gamepad.AXIS_RIGHT_Y) => float ry;
    Std.scalef(Math.fabs(ry), 0, 1, 0.0, 0.5) => rev.mix;

    Std.scalef(Gamepad.axis(0, Gamepad.AXIS_LEFT_TRIGGER), -1, 1, 0, 0.3) => float targetGain;

    smoothFreq + (targetFreq - smoothFreq) * 0.1 => smoothFreq;
    smoothGain + (targetGain - smoothGain) * 0.15 => smoothGain;
    smoothFilter + (targetFilter - smoothFilter) * 0.1 => smoothFilter;

    smoothFreq => osc1.freq => osc2.freq => osc3.freq => osc4.freq;
    smoothGain => osc1.gain => osc2.gain => osc3.gain => osc4.gain;
    smoothFilter => lpf.freq;

    @(lx * 2.0, -ly * 2.0, 0.0) => cursor.pos;

    Std.scalef(smoothFreq, 200, 4000, 0, 1) => float hue;
    @(hue, 0.3, 1.0 - hue) => cursor.color;
    0.1 + smoothGain * 0.5 => cursor.sca;

    waveNames[activeOsc] + " (A/B/X/Y)  Oct: " + octave + " (LB/RB)" => waveLabel.text;
    "Freq: " + Std.ftoa(smoothFreq, 0) + " Hz | Filter: " + Std.ftoa(smoothFilter, 0) +
    " Hz | Gain: " + Std.ftoa(smoothGain, 2) + " | Rev: " + Std.ftoa(rev.mix(), 2) +
    " | Pan: " + Std.ftoa(rx, 2) => paramText.text;
}
