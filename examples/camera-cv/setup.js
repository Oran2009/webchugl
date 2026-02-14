// Camera/CV Example: MediaPipe Hand Tracking Setup

(function() {
    'use strict';

    var VISION_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest';
    var MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';

    console.log('[Example: camera-cv] Loading MediaPipe Hand Landmarker...');

    import(VISION_CDN + '/vision_bundle.js')
        .then(function(vision) {
            console.log('[Example: camera-cv] MediaPipe loaded, initializing...');
            return initHandTracking(vision);
        })
        .catch(function(err) {
            console.error('[Example: camera-cv] Failed to load MediaPipe:', err.message);
        });

    async function initHandTracking(vision) {
        try {
            var fileset = await vision.FilesetResolver.forVisionTasks(VISION_CDN + '/wasm');
            var handLandmarker = await vision.HandLandmarker.createFromOptions(fileset, {
                baseOptions: {
                    modelAssetPath: MODEL_URL,
                    delegate: 'GPU'
                },
                runningMode: 'VIDEO',
                numHands: 1,
                minHandDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });

            console.log('[Example: camera-cv] Hand Landmarker ready, requesting camera...');

            // Open webcam
            var stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480, facingMode: 'user' }
            });

            var video = document.createElement('video');
            video.srcObject = stream;
            video.setAttribute('playsinline', '');
            video.style.display = 'none';
            document.body.appendChild(video);
            await video.play();

            console.log('[Example: camera-cv] Camera active, tracking hands...');

            var landmarkArray = new Array(63);  // 21 landmarks × 3 coords
            var lastTime = -1;

            function detect() {
                if (video.readyState >= 2) {
                    var now = performance.now();
                    // Only process new frames
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
                            CK.setFloatArray('handLandmarks', landmarkArray);
                            CK.setInt('handDetected', 1);
                        } else {
                            CK.setInt('handDetected', 0);
                        }

                        CK.broadcastEvent('handFrame');
                    }
                }
                requestAnimationFrame(detect);
            }

            requestAnimationFrame(detect);

        } catch (err) {
            console.error('[Example: camera-cv] Init failed:', err.message);
            CK.setInt('handDetected', 0);
            CK.broadcastEvent('handFrame');
        }
    }
})();
