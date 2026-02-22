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
 * each animation frame. Stops automatically when `isAlive()` returns false.
 */
export function initSensors(target: SensorTarget, isAlive: () => boolean): void {
    let accelPending: { x: number; y: number; z: number } | null = null;
    let gyroPending: { alpha: number; beta: number; gamma: number } | null = null;

    const flushSensors = (): void => {
        if (!isAlive()) return;
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
        const handleMotion = (e: DeviceMotionEvent): void => {
            const a = e.accelerationIncludingGravity;
            if (!a) return;
            accelPending = { x: a.x || 0, y: a.y || 0, z: a.z || 0 };
        };

        const DME = DeviceMotionEvent as unknown as DeviceMotionEventWithPermission;
        if (typeof DME.requestPermission === 'function') {
            const requestAccelPermission = (): void => {
                DME.requestPermission().then((state) => {
                    if (state === 'granted') {
                        window.addEventListener('devicemotion', handleMotion);
                    }
                }).catch(() => { /* permission denied or unavailable */ });
            };
            document.addEventListener('click', requestAccelPermission, { once: true });
            document.addEventListener('touchend', requestAccelPermission, { once: true });
        } else {
            window.addEventListener('devicemotion', handleMotion);
        }
    }

    // Gyroscope
    if (window.DeviceOrientationEvent) {
        const handleOrientation = (e: DeviceOrientationEvent): void => {
            gyroPending = { alpha: e.alpha || 0, beta: e.beta || 0, gamma: e.gamma || 0 };
        };

        const DOE = DeviceOrientationEvent as unknown as DeviceOrientationEventWithPermission;
        if (typeof DOE.requestPermission === 'function') {
            const requestGyroPermission = (): void => {
                DOE.requestPermission().then((state) => {
                    if (state === 'granted') {
                        window.addEventListener('deviceorientation', handleOrientation);
                    }
                }).catch(() => { /* permission denied or unavailable */ });
            };
            document.addEventListener('click', requestGyroPermission, { once: true });
            document.addEventListener('touchend', requestGyroPermission, { once: true });
        } else {
            window.addEventListener('deviceorientation', handleOrientation);
        }
    }
}
