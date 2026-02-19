// Web Data Example: Earthquake Data Visualization & Sonification
// Fetches real-time earthquake data and sonifies it.
// Each earthquake becomes a tone (magnitude → pitch) and a sphere (position → lat/lng).

global float magnitudes[0];
global float lats[0];
global float lngs[0];
global int dataCount;

// ── Audio ──────────────────────────────────────────────────────
SinOsc osc => ADSR env => NRev rev => dac;
env.set(10::ms, 80::ms, 0.0, 10::ms);
0.15 => rev.mix;

// ── Visuals ────────────────────────────────────────────────────
GText title --> GG.scene();
"Loading earthquake data..." => title.text;
0.08 => title.sca;
@(0.0, 1.5, 0.0) => title.pos;
Color.WHITE => title.color;

while (dataCount == 0) {
    GG.nextFrame() => now;
}

dataCount + " earthquakes loaded" => title.text;

Math.min(dataCount, 200) => int numVisual;
GSphere markers[numVisual];

for (0 => int i; i < numVisual; i++) {
    markers[i] --> GG.scene();

    Std.scalef(lngs[i], -180, 180, -2.5, 2.5) => float x;
    Std.scalef(lats[i], -90, 90, -1.2, 1.2) => float y;
    @(x, y, 0) => markers[i].pos;

    Math.max(magnitudes[i], 0.5) => float mag;
    mag * 0.02 => markers[i].sca;

    Std.scalef(mag, 0, 7, 0.0, 1.0) => float t;
    Math.min(t * 2, 1.0) => float r;
    Math.max(1.0 - t * 2, 0.0) => float g;
    @(r, g, 0.1) => markers[i].color;
}

0 => int idx;
while (true) {
    if (dataCount > 0) {
        magnitudes[idx] => float mag;

        // Magnitude → MIDI note (small quakes = low, large = high)
        Std.scalef(mag, 0, 7, 40, 90) => float note;
        Std.mtof(note) => osc.freq;

        // Magnitude → volume
        Std.scalef(mag, 0, 7, 0.05, 0.4) => osc.gain;

        if (idx < numVisual) {
            @(1, 1, 1) => markers[idx].color;
            0.08 => markers[idx].sca;
        }

        env.keyOn();
        80::ms => now;
        env.keyOff();
        40::ms => now;

        if (idx < numVisual) {
            Std.scalef(mag, 0, 7, 0.0, 1.0) => float t;
            Math.min(t * 2, 1.0) => float r;
            Math.max(1.0 - t * 2, 0.0) => float g;
            @(r, g, 0.1) => markers[idx].color;
            Math.max(mag, 0.5) * 0.02 => markers[idx].sca;
        }

        (idx + 1) % dataCount => idx;

        40::ms => now;
    } else {
        1::second => now;
    }

    GG.nextFrame() => now;
}
