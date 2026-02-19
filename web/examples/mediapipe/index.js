import ChuGL from '../../src/webchugl-esm.js';

var ck = await ChuGL.init({
    canvas: document.getElementById('canvas'),
    whereIsChuGL: '../../src/',
});

await ck.runFile('./main.ck');

// ── MediaPipe Hand Landmarker ───────────────────────────────

var VISION_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest';
var MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';

try {
    var vision = await import(VISION_CDN + '/vision_bundle.js');
    var fileset = await vision.FilesetResolver.forVisionTasks(VISION_CDN + '/wasm');
    var handLandmarker = await vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });

    var stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }
    });

    var video = document.createElement('video');
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.style.display = 'none';
    document.body.appendChild(video);
    await video.play();

    var landmarkArray = new Array(63);
    var lastTime = -1;

    function detect() {
        if (video.readyState >= 2) {
            var now = performance.now();
            if (now !== lastTime) {
                lastTime = now;
                var results = handLandmarker.detectForVideo(video, now);

                if (results.landmarks && results.landmarks.length > 0) {
                    var lm = results.landmarks[0];
                    for (var i = 0; i < 21; i++) {
                        landmarkArray[i * 3]     = lm[i].x;
                        landmarkArray[i * 3 + 1] = lm[i].y;
                        landmarkArray[i * 3 + 2] = lm[i].z;
                    }
                    ck.setFloatArray('handLandmarks', landmarkArray);
                    ck.setInt('handDetected', 1);
                } else {
                    ck.setInt('handDetected', 0);
                }
                ck.broadcastEvent('handFrame');
            }
        }
        requestAnimationFrame(detect);
    }
    requestAnimationFrame(detect);

    console.log('[MediaPipe] Hand tracking active');
} catch (err) {
    console.error('[MediaPipe] Init failed:', err.message);
    ck.setInt('handDetected', 0);
    ck.broadcastEvent('handFrame');
}
