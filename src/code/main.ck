// WebChuGL default program
// Replace this with your own ChucK + ChuGL code.

GG.camera().aspect(16./9);
GWindow.sizeLimits(0, 0, 0, 0, @(16, 9));
GG.scene().backgroundColor(Color.PURPLE);
GWindow.fullscreen();

GText text --> GG.scene();
"Hello, WebChuGL!" => text.text;
0.25 => text.sca;
Color.WHITE => text.color;

SinOsc osc => dac;
0.1 => osc.gain;

while (true) {
    GG.nextFrame() => now;
}
