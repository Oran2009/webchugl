global Event noteOn;
global int noteIndex;
global Event echo;

SinOsc osc => ADSR env => dac;
env.set(5::ms, 300::ms, 0.0, 100::ms);
0.4 => osc.gain;

[60, 62, 64, 65, 67, 69, 71] @=> int scale[];

GG.scene().ambient(@(0.5, 0.2, 0.1));
GSphere sphere --> GG.scene();
sphere.color(@(1.0, 0.3, 0.1));
GG.camera().pos(@(0, 0, 4));

time lastHit;
now => lastHit;
float echoFade;

fun void playLoop() {
    while (true) {
        noteOn => now;
        Std.mtof(scale[noteIndex]) => osc.freq;
        env.keyOn();
        now => lastHit;
    }
}
spork ~ playLoop();

fun void echoLoop() {
    while (true) {
        echo => now;
        1.0 => echoFade;
    }
}
spork ~ echoLoop();

while (true) {
    GG.nextFrame() => now;
    (now - lastHit) / second => float t;
    1.0 + 0.6 * Math.exp(-t * 8) => float s;
    sphere.sca(@(s, s, s));
    sphere.rotateY(0.3 * GG.dt());
    echoFade * 0.92 => echoFade;
    sphere.color(@(1.0, 0.3 + 0.7 * echoFade, 0.1 + 0.9 * echoFade));
}
