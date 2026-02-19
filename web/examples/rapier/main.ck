// 3D Physics (Rapier) — ChuGL visuals driven by JS physics simulation

// Globals synced from JavaScript
global float positions[150];  // 50 * 3 (x, y, z per body)
global float rotations[150];  // 50 * 3 (euler angles per body)
global int bodyCount;
global Event collision;

// ── Scene ────────────────────────────────────────────────────

// Ground
GCube ground --> GG.scene();
@(10.0, 0.1, 10.0) => ground.sca;
@(0.0, 0.0, 0.0) => ground.pos;
@(0.2, 0.22, 0.25) => ground.color;

// Pre-allocate falling boxes
50 => int MAX;
GCube boxes[MAX];

for (0 => int i; i < MAX; i++) {
    boxes[i] --> GG.scene();
    // Rainbow colors using offset sine waves
    Math.sin(i * 0.4) * 0.5 + 0.5 => float r;
    Math.sin(i * 0.4 + 2.094) * 0.5 + 0.5 => float g;
    Math.sin(i * 0.4 + 4.189) * 0.5 + 0.5 => float b;
    boxes[i].color(@(r, g, b));
    0.5 => boxes[i].sca;
    @(0, -100, 0) => boxes[i].pos;  // hide initially
}

// Camera
GG.camera().pos(@(8.0, 6.0, 8.0));
GG.camera().lookAt(@(0.0, 2.0, 0.0));

// Ambient light
GG.scene().ambient(@(0.5, 0.5, 0.5));

// ── Audio: collision impact sound ────────────────────────────

fun void playImpact() {
    Noise n => BPF f => ADSR e => dac;
    800.0 + Math.random2f(0.0, 2000.0) => f.freq;
    4.0 => f.Q;
    e.set(1::ms, 30::ms, 0.0, 5::ms);
    0.15 => e.gain;
    1 => e.keyOn;
    40::ms => now;
    1 => e.keyOff;
    10::ms => now;
    e =< dac;
}

fun void collisionListener() {
    while (true) {
        collision => now;
        spork ~ playImpact();
    }
}

spork ~ collisionListener();

// ── Render loop ──────────────────────────────────────────────

while (true) {
    GG.nextFrame() => now;

    for (0 => int i; i < MAX; i++) {
        if (i < bodyCount) {
            0.5 => boxes[i].sca;
            i * 3 => int p;
            boxes[i].pos(@(positions[p], positions[p+1], positions[p+2]));
            boxes[i].rot(@(rotations[p], rotations[p+1], rotations[p+2]));
        } else {
            @(0, -100, 0) => boxes[i].pos;
        }
    }
}
