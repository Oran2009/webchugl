// Camera/CV Example: Hand-Tracking Theremin
// Uses MediaPipe hand landmarks (via setup.js) to control a theremin.

global float handLandmarks[0];  // 63 floats: 21 landmarks × 3 coords (x,y,z)
global int handDetected;
global Event handFrame;

// ── Audio ──────────────────────────────────────────────────────
SinOsc osc => LPF lpf => NRev rev => dac;
2000 => lpf.freq;
2 => lpf.Q;
0.1 => rev.mix;
0 => osc.gain;

0.0 => float smoothFreq;
0.0 => float smoothGain;

// ── Visuals ────────────────────────────────────────────────────
GText title --> GG.scene();
"Waiting for camera..." => title.text;
0.06 => title.sca;
@(0.0, 1.6, 0.0) => title.pos;
Color.WHITE => title.color;

GText instructions --> GG.scene();
"" => instructions.text;
0.03 => instructions.sca;
@(0.0, 1.4, 0.0) => instructions.pos;
@(0.6, 0.6, 0.6) => instructions.color;

GSphere finger --> GG.scene();
0.06 => finger.sca;
@(0.2, 0.8, 1.0) => finger.color;

GSphere thumb --> GG.scene();
0.04 => thumb.sca;
@(1.0, 0.5, 0.2) => thumb.color;

GLines pinchLine --> GG.scene();
0.005 => pinchLine.width;
pinchLine.color(@(0.5, 0.5, 0.5));

for (0 => int i; i < 11; i++) {
    GLines hLine --> GG.scene();
    GLines vLine --> GG.scene();
    hLine.color(@(0.15, 0.15, 0.15));
    vLine.color(@(0.15, 0.15, 0.15));
    0.001 => hLine.width;
    0.001 => vLine.width;

    Std.scalef(i, 0, 10, -2.0, 2.0) => float pos;
    hLine.positions([@(-2, pos), @(2, pos)]);
    vLine.positions([@(pos, -1.5), @(pos, 1.5)]);
}

// Poll until camera starts sending frames
while (handDetected == 0) {
    GG.nextFrame() => now;
}
"" => title.text;
"Move index finger to play. Pinch to mute." => instructions.text;

// ── Main loop ───────────────────────────────────────────────────
while (true) {
    handFrame => now;

    if (handDetected) {
        handLandmarks[24] => float indexX;
        handLandmarks[25] => float indexY;

        handLandmarks[12] => float thumbX;
        handLandmarks[13] => float thumbY;

        // Map hand coords (0-1) to scene coords
        Std.scalef(indexX, 0, 1, 2.0, -2.0) => float sceneX;
        Std.scalef(indexY, 0, 1, 1.5, -1.5) => float sceneY;
        Std.scalef(thumbX, 0, 1, 2.0, -2.0) => float thumbSceneX;
        Std.scalef(thumbY, 0, 1, 1.5, -1.5) => float thumbSceneY;

        // Update visual positions
        @(sceneX, sceneY, 0) => finger.pos;
        @(thumbSceneX, thumbSceneY, 0) => thumb.pos;
        pinchLine.positions([@(sceneX, sceneY), @(thumbSceneX, thumbSceneY)]);

        // Pinch distance
        Math.sqrt((indexX - thumbX) * (indexX - thumbX) +
                  (indexY - thumbY) * (indexY - thumbY)) => float pinchDist;

        // Map X to frequency
        Std.scalef(indexX, 0, 1, 2000, 200) => float targetFreq;

        // Map Y to gain
        Std.scalef(indexY, 0, 1, 0.4, 0.02) => float baseGain;
        Std.scalef(pinchDist, 0.05, 0.15, 0.0, 1.0) => float pinchGate;
        Math.max(0, Math.min(1, pinchGate)) => pinchGate;
        baseGain * pinchGate => float targetGain;

        smoothFreq + (targetFreq - smoothFreq) * 0.15 => smoothFreq;
        smoothGain + (targetGain - smoothGain) * 0.2 => smoothGain;

        smoothFreq => osc.freq;
        smoothGain => osc.gain;
        smoothFreq * 3 => lpf.freq;

        Std.scalef(smoothFreq, 200, 2000, 0, 1) => float hue;
        @(1.0 - hue, 0.3, hue) => finger.color;

        0.04 + smoothGain * 0.15 => finger.sca;

        pinchLine.color(@(1.0 - pinchGate, pinchGate, 0.2));

    } else {
        smoothGain * 0.9 => smoothGain;
        smoothGain => osc.gain;
        0.04 => finger.sca;
    }

    GG.nextFrame() => now;
}
