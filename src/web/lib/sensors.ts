interface DeviceMotionEventWithPermission {
    requestPermission(): Promise<'granted' | 'denied'>;
}

interface DeviceOrientationEventWithPermission {
    requestPermission(): Promise<'granted' | 'denied'>;
}

/** Minimal interface for the sensor target — only needs setFloat and broadcastEvent. */
export interface SensorTarget {
    setFloat(name: string, val: number): void;
    broadcastEvent(name: string): void;
}

/**
 * Start accelerometer + gyroscope input, flushing readings to the target
 * each animation frame. Everything unwinds when `signal` aborts: listeners are
 * removed, the flush loop stops, and a permission prompt that resolves after
 * teardown can no longer attach to a torn-down target.
 */
export function initSensors(target: SensorTarget, signal: AbortSignal): void {
    let accelPending: { x: number; y: number; z: number } | null = null;
    let gyroPending: { alpha: number; beta: number; gamma: number } | null = null;

    const flushSensors = (): void => {
        if (signal.aborted) return;
        if (accelPending) {
            target.setFloat('_accelX', accelPending.x);
            target.setFloat('_accelY', accelPending.y);
            target.setFloat('_accelZ', accelPending.z);
            target.broadcastEvent('_accelReading');
            accelPending = null;
        }
        if (gyroPending) {
            target.setFloat('_gyroX', gyroPending.alpha);
            target.setFloat('_gyroY', gyroPending.beta);
            target.setFloat('_gyroZ', gyroPending.gamma);
            target.broadcastEvent('_gyroReading');
            gyroPending = null;
        }
        requestAnimationFrame(flushSensors);
    };
    requestAnimationFrame(flushSensors);

    // Accelerometer
    if (window.DeviceMotionEvent) {
        const onMotion = (e: DeviceMotionEvent): void => {
            const a = e.accelerationIncludingGravity;
            if (!a) return;
            accelPending = { x: a.x || 0, y: a.y || 0, z: a.z || 0 };
        };

        const DME = DeviceMotionEvent as unknown as DeviceMotionEventWithPermission;
        if (typeof DME.requestPermission === 'function') {
            const requestAccelPermission = (): void => {
                DME.requestPermission().then((state) => {
                    if (state === 'granted') {
                        window.addEventListener('devicemotion', onMotion, { signal });
                    }
                }).catch(() => { /* permission denied or unavailable */ });
            };
            document.addEventListener('click', requestAccelPermission, { once: true, signal });
            document.addEventListener('touchend', requestAccelPermission, { once: true, signal });
        } else {
            window.addEventListener('devicemotion', onMotion, { signal });
        }
    }

    // Gyroscope
    if (window.DeviceOrientationEvent) {
        const onOrientation = (e: DeviceOrientationEvent): void => {
            gyroPending = { alpha: e.alpha || 0, beta: e.beta || 0, gamma: e.gamma || 0 };
        };

        const DOE = DeviceOrientationEvent as unknown as DeviceOrientationEventWithPermission;
        if (typeof DOE.requestPermission === 'function') {
            const requestGyroPermission = (): void => {
                DOE.requestPermission().then((state) => {
                    if (state === 'granted') {
                        window.addEventListener('deviceorientation', onOrientation, { signal });
                    }
                }).catch(() => { /* permission denied or unavailable */ });
            };
            document.addEventListener('click', requestGyroPermission, { once: true, signal });
            document.addEventListener('touchend', requestGyroPermission, { once: true, signal });
        } else {
            window.addEventListener('deviceorientation', onOrientation, { signal });
        }
    }
}
