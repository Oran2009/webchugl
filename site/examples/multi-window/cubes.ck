global Event noteOn;
global int noteIndex;
global Event echo;

TriOsc osc => ADSR env => NRev rev => dac;
0.05 => rev.mix;
env.set(2::ms, 100::ms, 0.0, 150::ms);
0.3 => osc.gain;

[72, 74, 76, 77, 79, 81, 83] @=> int scale[];

GG.scene().ambient(@(0.1, 0.2, 0.5));
GCube cubes[7];
for (int i; i < cubes.size(); i++) {
    cubes[i] --> GG.scene();
    cubes[i].sca(@(0.25, 0.25, 0.25));
    cubes[i].pos(@((i - 3) * 0.55, 0, 0));
    cubes[i].color(@(0.3, 0.5, 1.0));
}
GG.camera().pos(@(0, 0, 4));

time lastHit;
now => lastHit;
-1 => int activeIdx;
float echoFade;

fun void listenLoop() {
    while (true) {
        noteOn => now;
        noteIndex => activeIdx;
        Std.mtof(scale[activeIdx]) => osc.freq;
        env.keyOn();
        now => lastHit;
    }
}
spork ~ listenLoop();

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
    Math.exp(-t * 5) => float fade;
    echoFade * 0.92 => echoFade;
    for (int i; i < cubes.size(); i++) {
        0.0 => float y;
        if (i == activeIdx) fade * 0.5 +=> y;
        echoFade * 0.3 +=> y;
        cubes[i].posY(cubes[i].posY() * 0.85 + y * 0.15);
        if (i == activeIdx) {
            cubes[i].color(@(0.3 + 0.7 * fade, 0.5 + 0.5 * fade, 1.0));
        } else {
            cubes[i].color(@(0.3 + 0.3 * echoFade, 0.5 + 0.3 * echoFade, 1.0));
        }
        cubes[i].rotateY(1.2 * GG.dt());
    }
}
