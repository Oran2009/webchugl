// Recorder Example: Capture ChucK audio output via MediaRecorder

global int isRecording;
global float recordingTime;

[60, 62, 64, 67, 69, 72, 74, 76, 79, 81] @=> int notes[];

SinOsc osc1 => ADSR env1 => NRev rev => dac;
TriOsc osc2 => ADSR env2 => rev;
SinOsc sub => ADSR envSub => rev;

env1.set(80::ms, 300::ms, 0.3, 500::ms);
env2.set(40::ms, 200::ms, 0.2, 400::ms);
envSub.set(20::ms, 400::ms, 0.4, 600::ms);
0.25 => rev.mix;

TriOsc pad => LPF padLpf => NRev padRev => dac;
800 => padLpf.freq;
2 => padLpf.Q;
0.35 => padRev.mix;
0.0 => pad.gain;

GText recText --> GG.scene();
0.08 => recText.sca;
@(0.0, 1.3, 0.0) => recText.pos;

GCircle recDot --> GG.scene();
0.0 => recDot.sca;
@(-0.6, 1.3, 0.0) => recDot.pos;
Color.RED => recDot.color;

GCircle vis[5];
for (0 => int i; i < 5; i++) {
    vis[i] --> GG.scene();
    0.0 => vis[i].sca;
    Std.scalef(i, 0, 4, -1.5, 1.5) => float x;
    @(x, 0.0, 0.0) => vis[i].pos;
}

fun void playMelody() {
    while (true) {
        Math.random2(0, notes.size() - 1) => int idx;
        Std.mtof(notes[idx]) => osc1.freq;
        Std.mtof(notes[idx]) => osc2.freq;
        Std.mtof(notes[idx] - 12) => sub.freq;

        0.12 => osc1.gain;
        0.08 => osc2.gain;
        0.1 => sub.gain;
        env1.keyOn();
        env2.keyOn();
        envSub.keyOn();

        Math.random2(0, 4) => int vi;
        0.3 => vis[vi].sca;
        Std.scalef(notes[idx], 60, 81, 0.2, 1.0) => float hue;
        @(hue, 0.4, 1.0 - hue) => vis[vi].color;

        notes[idx] - 60 => int rel;

        Math.random2(200, 800)::ms => dur d;
        d => now;

        env1.keyOff();
        env2.keyOff();
        envSub.keyOff();

        Math.random2(100, 500)::ms => now;
    }
}
spork ~ playMelody();

fun void playPad() {
    while (true) {
        Math.random2(0, 4) => int idx;
        Std.mtof(notes[idx] - 12) => pad.freq;
        0.06 => pad.gain;

        for (0 => int i; i < 40; i++) {
            padLpf.freq() + (1200 - padLpf.freq()) * 0.05 => padLpf.freq;
            50::ms => now;
        }

        Math.random2f(2.0, 4.0)::second => now;

        for (0 => int i; i < 30; i++) {
            padLpf.freq() * 0.9 => padLpf.freq;
            50::ms => now;
        }

        500::ms => now;
    }
}
spork ~ playPad();

while (true) {
    GG.nextFrame() => now;

    if (isRecording) {
        "REC  " + Std.ftoa(recordingTime, 1) + "s" => recText.text;
        Color.RED => recText.color;
        0.06 + Math.sin(now / second * 4.0) * 0.02 => recDot.sca;
    } else {
        "Press Record to capture audio" => recText.text;
        @(0.5, 0.5, 0.5) => recText.color;
        0.0 => recDot.sca;
    }

    for (0 => int i; i < 5; i++) {
        if (vis[i].scaX() > 0.01) {
            vis[i].scaX() * 0.96 => vis[i].sca;
        } else {
            0 => vis[i].sca;
        }
    }
}
