// Speech Example: Web Speech Recognition → ChucK
// Say "kick", "snare", "hat" to trigger drum sounds.
// Say "stop"/"go" to pause/resume. Other words are sonified letter-by-letter.

global string spokenWord;
global int command;
global Event wordSpoken;

// Drum voices (synthesis-based)
SinOsc kick => ADSR kickEnv => dac;
kickEnv.set(2::ms, 120::ms, 0.0, 10::ms);
0 => kick.gain;

Noise snareNoise => BPF snareBpf => ADSR snareEnv => dac;
2000 => snareBpf.freq;
2 => snareBpf.Q;
snareEnv.set(1::ms, 80::ms, 0.0, 10::ms);

Noise hatNoise => HPF hatHpf => ADSR hatEnv => dac;
8000 => hatHpf.freq;
hatEnv.set(1::ms, 30::ms, 0.0, 5::ms);

// Melodic voice for text sonification
SinOsc mel => ADSR melEnv => NRev rev => dac;
melEnv.set(5::ms, 100::ms, 0.0, 20::ms);
0.12 => rev.mix;

1 => int playing; // controlled by stop/go

// Visuals
GText wordDisplay --> GG.scene();
0.12 => wordDisplay.sca;
@(0.0, 0.5, 0.0) => wordDisplay.pos;
Color.WHITE => wordDisplay.color;

GText cmdDisplay --> GG.scene();
0.04 => cmdDisplay.sca;
@(0.0, -0.5, 0.0) => cmdDisplay.pos;
@(0.5, 0.5, 0.5) => cmdDisplay.color;

GText instructions --> GG.scene();
0.03 => instructions.sca;
@(0.0, -1.5, 0.0) => instructions.pos;
@(0.4, 0.4, 0.4) => instructions.color;
"Say: kick / snare / hat / stop / go  (or any word)" => instructions.text;

GText stateText --> GG.scene();
0.03 => stateText.sca;
@(0.0, 1.5, 0.0) => stateText.pos;
Color.YELLOW => stateText.color;
"Listening..." => stateText.text;

// Flash circle
GCircle flash --> GG.scene();
0.0 => flash.sca;

// Helper: play kick drum
fun void playKick() {
    150 => kick.freq;
    0.4 => kick.gain;
    kickEnv.keyOn();
    // Pitch envelope: sweep down
    spork ~ _kickSweep();
}

fun void _kickSweep() {
    150.0 => float f;
    while (f > 40) {
        f * 0.92 => f;
        f => kick.freq;
        2::ms => now;
    }
    kickEnv.keyOff();
}

// Helper: play snare
fun void playSnare() {
    0.3 => snareNoise.gain;
    snareEnv.keyOn();
    60::ms => now;
    snareEnv.keyOff();
}

// Helper: play hihat
fun void playHat() {
    0.15 => hatNoise.gain;
    hatEnv.keyOn();
    20::ms => now;
    hatEnv.keyOff();
}

// Helper: sonify a word letter by letter
fun void sonifyWord(string word) {
    for (0 => int i; i < word.length(); i++) {
        word.charAt(i) => int ch;
        // Map a-z to C4–B5 (MIDI 60–83)
        if (ch >= 97 && ch <= 122) {
            60 + (ch - 97) => int note;
            Std.mtof(note) => mel.freq;
            0.15 => mel.gain;
            melEnv.keyOn();
            80::ms => now;
            melEnv.keyOff();
            20::ms => now;
        } else {
            40::ms => now; // pause for non-letters
        }
    }
}

// Command listener shred
fun void listener() {
    while (true) {
        wordSpoken => now;

        // Display the word
        spokenWord => wordDisplay.text;

        if (command == 0) {
            // Kick
            "KICK" => cmdDisplay.text;
            @(1.0, 0.3, 0.1) => flash.color;
            0.4 => flash.sca;
            if (playing) playKick();
        } else if (command == 1) {
            // Snare
            "SNARE" => cmdDisplay.text;
            @(1.0, 1.0, 0.2) => flash.color;
            0.3 => flash.sca;
            if (playing) playSnare();
        } else if (command == 2) {
            // Hihat
            "HAT" => cmdDisplay.text;
            @(0.5, 1.0, 0.5) => flash.color;
            0.2 => flash.sca;
            if (playing) playHat();
        } else if (command == 3) {
            // Stop
            0 => playing;
            "STOPPED" => stateText.text;
            @(1.0, 0.2, 0.2) => stateText.color;
            "" => cmdDisplay.text;
        } else if (command == 4) {
            // Go
            1 => playing;
            "Listening..." => stateText.text;
            Color.YELLOW => stateText.color;
            "" => cmdDisplay.text;
        } else if (command == -1) {
            // Sonify the word
            @(0.3, 0.5, 1.0) => flash.color;
            0.2 => flash.sca;
            "" => cmdDisplay.text;
            if (playing) spork ~ sonifyWord(spokenWord);
        }
    }
}
spork ~ listener();

// Main loop: animate flash circle
while (true) {
    GG.nextFrame() => now;

    // Fade flash
    if (flash.scaX() > 0.01) {
        flash.scaX() * 0.92 => flash.sca;
    } else {
        0 => flash.sca;
    }
}
