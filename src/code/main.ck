// HTML Integration Demo
// Responds to global variables set from HTML UI controls

global float rotation_speed;
global float scale_factor;
global int color_mode;
global Event reset_event;

// Defaults
1.0 => scale_factor;
1.0 => rotation_speed;

GPlane plane --> GG.scene();
plane.sca(@(2, 2, 1));

// Background
GG.scene().backgroundColor(@(0.05, 0.05, 0.1));

// Spork listener for reset event
spork ~ resetListener();

fun void resetListener() {
    while (true) {
        reset_event => now;
        0.0 => plane.rotY;
    }
}

// Main loop
while (true) {
    GG.nextFrame() => now;
    GG.dt() * rotation_speed => float dr;
    plane.rotY() + dr => plane.rotY;
    plane.sca(@(scale_factor, scale_factor, 1));

    if (color_mode == 0)
        plane.color(@(0.4, 0.8, 0.2));
    else if (color_mode == 1)
        plane.color(@(0.2, 0.4, 0.8));
    else
        plane.color(@(0.8, 0.2, 0.4));
}
