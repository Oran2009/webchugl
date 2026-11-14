// Drag & Drop Example: Audio File Player
// Controls: Space=play/pause, Left/Right=prev/next, Up/Down=speed

global string loadedFile;
global int fileCount;
global Event fileLoaded;

// Audio chain
SndBuf buf => LPF lpf => NRev rev => dac;
4000 => lpf.freq;
0.08 => rev.mix;
0 => buf.gain;

// Track list (max 20 files)
string filePaths[20];
string fileNames[20];
0 => int numFiles;
-1 => int currentTrack;
1 => int isPlaying;
1.0 => float playRate;

// Visuals
GText titleText --> GG.scene();
0.06 => titleText.sca;
@(0.0, 1.5, 0.0) => titleText.pos;
Color.WHITE => titleText.color;
"Drag audio files onto this page" => titleText.text;

GText trackText --> GG.scene();
0.04 => trackText.sca;
@(0.0, 1.0, 0.0) => trackText.pos;
Color.YELLOW => trackText.color;

GText controlText --> GG.scene();
0.025 => controlText.sca;
@(0.0, -1.8, 0.0) => controlText.pos;
@(0.4, 0.4, 0.4) => controlText.color;
"Space: play/pause | Arrows: prev/next/speed" => controlText.text;

GText posText --> GG.scene();
0.03 => posText.sca;
@(0.0, -1.4, 0.0) => posText.pos;
@(0.5, 0.5, 0.5) => posText.color;

// Progress bar
GPlane barBg --> GG.scene();
@(3.0, 0.04, 1.0) => barBg.sca;
@(0.0, 0.0, 0.0) => barBg.pos;
@(0.2, 0.2, 0.2) => barBg.color;

GPlane barFill --> GG.scene();
@(0.0, 0.04, 1.0) => barFill.sca;
@(0.0, 0.0, 0.1) => barFill.pos;
@(0.3, 0.7, 1.0) => barFill.color;

// Helper: extract filename from path
fun string basename(string path) {
    // Find last '/'
    path.length() - 1 => int last;
    for (last => int i; i >= 0; i--) {
        if (path.charAt(i) == 47) { // '/'
            return path.substring(i + 1);
        }
    }
    return path;
}

// Helper: load and play a track
fun void loadTrack(int idx) {
    if (idx < 0 || idx >= numFiles) return;
    idx => currentTrack;
    filePaths[idx] => buf.read;
    0 => buf.pos;
    playRate => buf.rate;
    0.5 => buf.gain;
    1 => isPlaying;
    basename(filePaths[idx]) => fileNames[idx];
}

// Shred: listen for new files
fun void fileListener() {
    while (true) {
        fileLoaded => now;

        if (numFiles < 20) {
            loadedFile => filePaths[numFiles];
            basename(loadedFile) => fileNames[numFiles];
            numFiles++;

            // Auto-play first file
            if (numFiles == 1) {
                loadTrack(0);
                "Now playing:" => titleText.text;
            }
        }
    }
}
spork ~ fileListener();

// Main loop
while (true) {
    GG.nextFrame() => now;

    // Keyboard controls
    if (GWindow.keyDown(GWindow.KEY_SPACE)) {
        if (isPlaying) {
            0 => isPlaying;
            0 => buf.rate;
        } else {
            1 => isPlaying;
            playRate => buf.rate;
        }
    }

    if (GWindow.keyDown(GWindow.KEY_RIGHT) && numFiles > 0) {
        loadTrack((currentTrack + 1) % numFiles);
    }

    if (GWindow.keyDown(GWindow.KEY_LEFT) && numFiles > 0) {
        loadTrack((currentTrack - 1 + numFiles) % numFiles);
    }

    if (GWindow.keyDown(GWindow.KEY_UP)) {
        Math.min(playRate + 0.1, 3.0) => playRate;
        if (isPlaying) playRate => buf.rate;
    }

    if (GWindow.keyDown(GWindow.KEY_DOWN)) {
        Math.max(playRate - 0.1, 0.1) => playRate;
        if (isPlaying) playRate => buf.rate;
    }

    // Update display
    if (currentTrack >= 0 && numFiles > 0) {
        fileNames[currentTrack] => trackText.text;

        // Progress
        if (buf.samples() > 0) {
            buf.pos() $ float / buf.samples() => float progress;
            progress * 3.0 => barFill.scaX;
            -1.5 + progress * 1.5 => barFill.posX;
        }

        (currentTrack + 1) + "/" + numFiles +
        " | Rate: " + Std.ftoa(playRate, 1) + "x" +
        (isPlaying ? " | Playing" : " | Paused") => posText.text;

        // Auto-advance when track ends
        if (isPlaying && buf.pos() >= buf.samples() - 1 && buf.samples() > 0 && numFiles > 1) {
            loadTrack((currentTrack + 1) % numFiles);
        }
    }
}
