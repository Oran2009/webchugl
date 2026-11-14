// Live Data Example: Wikipedia Edit Sonification

global string editTitle;
global string editUser;
global string editWiki;
global int editSize;
global int editType;
global Event newEdit;

SinOsc sinVoice => ADSR env0 => NRev rev => dac;  // edit
TriOsc triVoice => ADSR env1 => rev;               // new page
Noise noise => BPF bpf => ADSR env2 => rev;        // categorize/log

env0.set(5::ms, 60::ms, 0.0, 10::ms);
env1.set(5::ms, 100::ms, 0.0, 10::ms);
env2.set(2::ms, 40::ms, 0.0, 5::ms);
0 => sinVoice.gain => triVoice.gain;
0.3 => noise.gain;
1000 => bpf.freq;
4 => bpf.Q;
0.12 => rev.mix;

// Visuals
GG.camera().orthographic();
GG.camera().viewSize(5);

GText titleText --> GG.scene();
0.04 => titleText.sca;
@(0.0, 2.2, 0.0) => titleText.pos;
Color.WHITE => titleText.color;
"Waiting for Wikipedia edits..." => titleText.text;

GText userText --> GG.scene();
0.03 => userText.sca;
@(0.0, 1.9, 0.0) => userText.pos;
@(0.5, 0.5, 0.5) => userText.color;

GText statsText --> GG.scene();
0.03 => statsText.sca;
@(0.0, -2.2, 0.0) => statsText.pos;
@(0.4, 0.4, 0.4) => statsText.color;

// Dot pool for visual blips (ring buffer of 60 dots)
60 => int POOL_SIZE;
GCircle dots[POOL_SIZE];
float dotAlpha[POOL_SIZE];
0 => int nextDot;
0 => int totalEdits;

for (0 => int i; i < POOL_SIZE; i++) {
    dots[i] --> GG.scene();
    0.0 => dots[i].sca;
    0.0 => dotAlpha[i];
}

// Spawn a new dot at a random position
fun void spawnDot(int size, int type) {
    Math.random2f(-2.2, 2.2) => float x;
    Math.random2f(-1.5, 1.5) => float y;
    @(x, y, 0) => dots[nextDot].pos;

    // Size from edit magnitude
    Math.min(Math.fabs(size) / 500.0, 1.0) * 0.15 + 0.03 => dots[nextDot].sca;

    // Color by type
    if (type == 0)      @(0.3, 0.7, 1.0) => dots[nextDot].color; // edit = blue
    else if (type == 1) @(0.3, 1.0, 0.4) => dots[nextDot].color; // new = green
    else                @(1.0, 0.6, 0.2) => dots[nextDot].color;  // other = orange

    1.0 => dotAlpha[nextDot];
    (nextDot + 1) % POOL_SIZE => nextDot;
}

// Shred: listen for edit events
fun void editListener() {
    while (true) {
        newEdit => now;
        totalEdits++;

        // Clamp edit size for pitch mapping
        Math.max(-5000, Math.min(5000, editSize)) => int clampedSize;

        // Map edit size to MIDI note: large deletions = low, large additions = high
        Std.scalef(clampedSize, -5000, 5000, 40, 90) => float note;
        Std.mtof(note) => float freq;

        // Play sound based on type
        if (editType == 0) {
            // Regular edit → sine
            freq => sinVoice.freq;
            Std.scalef(Math.fabs(clampedSize), 0, 5000, 0.05, 0.25) => sinVoice.gain;
            env0.keyOn();
            50::ms => now;
            env0.keyOff();
        } else if (editType == 1) {
            // New page → triangle (longer, brighter)
            freq => triVoice.freq;
            0.15 => triVoice.gain;
            env1.keyOn();
            80::ms => now;
            env1.keyOff();
        } else {
            // Categorize/log → noise blip
            freq => bpf.freq;
            env2.keyOn();
            30::ms => now;
            env2.keyOff();
        }

        // Update text
        editTitle => titleText.text;
        editUser + " @ " + editWiki => userText.text;

        // Spawn visual dot
        spawnDot(clampedSize, editType);
    }
}
spork ~ editListener();

// Main loop: fade dots, update stats
while (true) {
    GG.nextFrame() => now;

    // Fade all dots
    for (0 => int i; i < POOL_SIZE; i++) {
        if (dotAlpha[i] > 0.01) {
            dotAlpha[i] * 0.97 => dotAlpha[i];
            dots[i].sca() * 0.995 => dots[i].sca;
        } else {
            0 => dots[i].sca;
        }
    }

    "Edits: " + totalEdits => statsText.text;
}
