// MIDI Example: Visual MIDI Monitor
// Opens MIDI input and displays received notes as colored bars.
// Connect a MIDI controller or use a virtual MIDI device to test.

MidiIn min;
MidiMsg msg;

// In the browser, wait until MIDI access is granted.
while (!min.open(0)) {
    <<< "[MIDI] Waiting for MIDI access (grant browser permission)..." >>>;
    GG.nextFrame() => now;
}
<<< "[MIDI] Opened:", min.name() >>>;

TriOsc osc => ADSR env => NRev rev => dac;
env.set(5::ms, 50::ms, 0.3, 100::ms);
0.1 => rev.mix;

GText status --> GG.scene();
0.06 => status.sca;
@(0.0, 1.5, 0.0) => status.pos;
Color.WHITE => status.color;
"Waiting for MIDI input..." => status.text;

GText noteText --> GG.scene();
0.05 => noteText.sca;
@(0.0, -1.5, 0.0) => noteText.pos;
Color.YELLOW => noteText.color;
"" => noteText.text;

GPlane bars[128];
int barActive[128];

while (true) {
    while (min.recv(msg)) {
        msg.data1 => int type;
        msg.data2 => int note;
        msg.data3 => int vel;

        // Note On
        if (type >= 144 && type < 160 && vel > 0) {
            "Note ON: " + note + " vel: " + vel => status.text;

            Std.mtof(note) => osc.freq;
            vel / 127.0 * 0.3 => osc.gain;
            env.keyOn();

            if (!barActive[note]) {
                bars[note] --> GG.scene();
                1 => barActive[note];
            }

            Std.scalef(note, 0, 127, -2.5, 2.5) => float x;
            vel / 127.0 => float h;
            @(x, 0.0, 0.0) => bars[note].pos;
            @(0.03, h * 2.0, 1.0) => bars[note].sca;

            Std.scalef(note, 0, 127, 0.0, 1.0) => float t;
            @(t, 1.0 - t, 0.5) => bars[note].color;

            note + " (" + Std.mtof(note) + " Hz)" => noteText.text;
        }

        // Note Off
        if ((type >= 128 && type < 144) || (type >= 144 && type < 160 && vel == 0)) {
            "Note OFF: " + note => status.text;
            env.keyOff();

            if (barActive[note]) {
                bars[note] --< GG.scene();
                0 => barActive[note];
            }
        }
    }

    GG.nextFrame() => now;
}
