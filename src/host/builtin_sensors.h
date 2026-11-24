#pragma once

// Compiled into the VM before user code. Mirrors WebChucK's Accel/Gyro API:
// https://github.com/ccrma/webchuck

static const char* k_AccelMsg_ck = R"CK(
public class AccelMsg {
    float accelX;
    float accelY;
    float accelZ;

    function float getAccelX() {
        return accelX;
    }

    function float getAccelY() {
        return accelY;
    }

    function float getAccelZ() {
        return accelZ;
    }

    function void _copy(AccelMsg localMsg) {
        localMsg.accelX => accelX;
        localMsg.accelY => accelY;
        localMsg.accelZ => accelZ;
    }
}
)CK";

static const char* k_Accel_ck = R"CK(
global Event _accelReading;
global int _accelActive;

global float _accelX;
global float _accelY;
global float _accelZ;

public class Accel extends Event {

    0 => int isAccelOpen;
    0 => int active;

    string deviceName;

    AccelMsg _accelMsgQueue[0];

    function string name() {
        return deviceName;
    }

    function int openAccel(int num) {
        if (num < 0) {
            false => active;
        } else {
            "js DeviceMotionEvent" => deviceName;
            true => active;
        }
        active => isAccelOpen => _accelActive;
        spork ~ _accelListener();
        return active;
    }

    function int recv(AccelMsg msg) {
        if (_accelMsgQueue.size() <= 0) {
            return 0;
        }

        _accelMsgQueue[0] @=> AccelMsg localMsg;
        msg._copy(localMsg);
        _accelMsgQueue.popFront();
        return 1;
    }

    function void _accelListener() {
        AccelMsg @ msg;
        while(true){
            new AccelMsg @=> msg;
            _accelReading => now;

            _accelX => msg.accelX;
            _accelY => msg.accelY;
            _accelZ => msg.accelZ;

            _accelMsgQueue << msg;
            this.broadcast();
        }
    }
}
)CK";

static const char* k_GyroMsg_ck = R"CK(
public class GyroMsg {
    float gyroX;
    float gyroY;
    float gyroZ;

    function float getGyroX() {
        return gyroX;
    }

    function float getGyroY() {
        return gyroY;
    }

    function float getGyroZ() {
        return gyroZ;
    }

    function void _copy(GyroMsg localMsg) {
        localMsg.gyroX => gyroX;
        localMsg.gyroY => gyroY;
        localMsg.gyroZ => gyroZ;
    }
}
)CK";

static const char* k_Gyro_ck = R"CK(
global Event _gyroReading;
global int _gyroActive;

global float _gyroX;
global float _gyroY;
global float _gyroZ;

public class Gyro extends Event {

    0 => int isGyroOpen;
    0 => int active;

    string deviceName;

    GyroMsg _gyroMsgQueue[0];

    function string name() {
        return deviceName;
    }

    function int openGyro(int num) {
        if (num < 0) {
            false => active;
        } else {
            "js DeviceOrientationEvent" => deviceName;
            true => active;
        }
        active => isGyroOpen => _gyroActive;
        spork ~ _gyroListener();
        return active;
    }

    function int recv(GyroMsg msg) {
        if (_gyroMsgQueue.size() <= 0) {
            return 0;
        }

        _gyroMsgQueue[0] @=> GyroMsg localMsg;
        msg._copy(localMsg);
        _gyroMsgQueue.popFront();
        return 1;
    }

    function void _gyroListener() {
        GyroMsg @ msg;
        while(true){
            new GyroMsg @=> msg;
            _gyroReading => now;

            _gyroX => msg.gyroX;
            _gyroY => msg.gyroY;
            _gyroZ => msg.gyroZ;

            _gyroMsgQueue << msg;
            this.broadcast();
        }
    }
}
)CK";
