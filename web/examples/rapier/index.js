import RAPIER from 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat/+esm';
import ChuGL from 'https://cdn.jsdelivr.net/npm/webchugl/+esm';

// Initialize Rapier WASM
await RAPIER.init();

// Initialize WebChuGL
var ck = await ChuGL.init({
    canvas: document.getElementById('canvas'),
    whereIsChuGL: '../../src/',
});

await ck.runFile('./main.ck');

// ── Constants ────────────────────────────────────────────────

var MAX_BODIES = 50;

// ── Rapier world ─────────────────────────────────────────────

var gravity = new RAPIER.Vector3(0.0, -9.81, 0.0);
var world = new RAPIER.World(gravity);
var eventQueue = new RAPIER.EventQueue(true);

// Ground (static rigid body with large cuboid collider)
var groundDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
var groundBody = world.createRigidBody(groundDesc);
world.createCollider(RAPIER.ColliderDesc.cuboid(5, 0.05, 5), groundBody);

// Dynamic bodies
var bodies = [];

function dropBox() {
    if (bodies.length >= MAX_BODIES) return;
    var x = (Math.random() - 0.5) * 4;
    var z = (Math.random() - 0.5) * 4;
    var y = 6 + Math.random() * 4;
    var desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z);
    var body = world.createRigidBody(desc);
    var colliderDesc = RAPIER.ColliderDesc.cuboid(0.25, 0.25, 0.25)
        .setRestitution(0.3)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    world.createCollider(colliderDesc, body);
    bodies.push(body);
}

function reset() {
    for (var i = bodies.length - 1; i >= 0; i--) {
        world.removeRigidBody(bodies[i]);
    }
    bodies = [];
}

// ── UI ───────────────────────────────────────────────────────

var statusEl = document.getElementById('status');

document.getElementById('btn-drop').addEventListener('click', function() {
    dropBox();
});

document.getElementById('btn-drop5').addEventListener('click', function() {
    for (var i = 0; i < 5; i++) dropBox();
});

document.getElementById('btn-reset').addEventListener('click', reset);

// ── Quaternion to Euler (ZYX convention) ─────────────────────

function quatToEuler(q) {
    var x = q.x, y = q.y, z = q.z, w = q.w;
    // Roll (X-axis rotation)
    var sinr = 2 * (w * x + y * z);
    var cosr = 1 - 2 * (x * x + y * y);
    var roll = Math.atan2(sinr, cosr);
    // Pitch (Y-axis rotation)
    var sinp = 2 * (w * y - z * x);
    var pitch = Math.abs(sinp) >= 1
        ? Math.sign(sinp) * Math.PI / 2
        : Math.asin(sinp);
    // Yaw (Z-axis rotation)
    var siny = 2 * (w * z + x * y);
    var cosy = 1 - 2 * (y * y + z * z);
    var yaw = Math.atan2(siny, cosy);
    return [roll, pitch, yaw];
}

// ── Physics loop ─────────────────────────────────────────────

var positions = new Array(MAX_BODIES * 3).fill(0);
var rotations = new Array(MAX_BODIES * 3).fill(0);

function step() {
    world.step(eventQueue);

    // Check for new collisions
    var hadCollision = false;
    eventQueue.drainCollisionEvents(function(handle1, handle2, started) {
        if (started) hadCollision = true;
    });

    // Collect transforms from all dynamic bodies
    for (var i = 0; i < bodies.length; i++) {
        var pos = bodies[i].translation();
        var rot = bodies[i].rotation();
        var euler = quatToEuler(rot);
        var p = i * 3;
        positions[p]     = pos.x;
        positions[p + 1] = pos.y;
        positions[p + 2] = pos.z;
        rotations[p]     = euler[0];
        rotations[p + 1] = euler[1];
        rotations[p + 2] = euler[2];
    }

    // Send to ChucK
    ck.setInt('bodyCount', bodies.length);
    ck.setFloatArray('positions', positions);
    ck.setFloatArray('rotations', rotations);
    if (hadCollision) ck.broadcastEvent('collision');

    statusEl.textContent = 'Bodies: ' + bodies.length;
    requestAnimationFrame(step);
}

requestAnimationFrame(step);
