//-----------------------------------------------------------------------------
// name: particles.ck (web version)
// desc: sonifying a simple particle system
//       adapted from https://chuck.stanford.edu/chugl/examples/deep/particles.ck
//       with HTML controls instead of ImGUI
//
// author: Andrew Zhu Aday (https://ccrma.stanford.edu/~azaday/)
//   date: Fall 2024
//-----------------------------------------------------------------------------

// global variables bridged from HTML controls
global float bg_r, bg_g, bg_b;
global float start_r, start_g, start_b;
global float end_r, end_g, end_b;
global float g_lifetime;
global int g_blend_mode;

// camera setup
GG.camera().orthographic();

// initial colors
@(0.0, 0.032, 0.067) => vec3 bg_color;    // 0.1 * DARKBLUE
@(0.4, 0.749, 1.0) => vec3 start_color;   // SKYBLUE
@(0.439, 0.122, 0.494) => vec3 end_color;  // DARKPURPLE

// set initial scene background
bg_color => GG.scene().backgroundColor;

// set initial global values (so HTML defaults stay in sync)
bg_color.x => bg_r;  bg_color.y => bg_g;  bg_color.z => bg_b;
start_color.x => start_r;  start_color.y => start_g;  start_color.z => start_b;
end_color.x => end_r;  end_color.y => end_g;  end_color.z => end_b;
1.0 => float lifetime_val;
1.0 => g_lifetime;

// geometry
CircleGeometry particle_geo;
// pitch bank
[48, 53, 55, 60, 63, 67, 70, 72, 74] @=> int pitches[];
// audio graph
Gain main_gain(1) => dac;

// previous blend mode (for change detection)
0 => int prev_blend_mode;

// custom Particle class (graphics + audio)
class Particle
{
    // set up particle mesh
    FlatMaterial particle_mat;
    GMesh particle_mesh(particle_geo, particle_mat) --> GG.scene();
    0 => particle_mesh.sca;

    // particle properties
    @(0,1) => vec2 direction; // random direction
    time spawn_time;
    Color.WHITE => vec3 color;

    // particle audio
    TriOsc osc => ADSR env => main_gain;
    .05 => osc.gain;
    55::ms => env.attackTime;
    750::ms => env.decayTime;
    .1 => env.sustainLevel;
    1::second => env.releaseTime;
}

// size of particle pool
256 => int PARTICLE_POOL_SIZE;
Particle particles[PARTICLE_POOL_SIZE];

// particle system class
class ParticleSystem
{
    // number of active particles
    0 => int num_active;

    // update
    fun void update(float dt)
    {
        // update particles
        for (0 => int i; i < num_active; i++)
        {
            // the current particle
            particles[i] @=> Particle p;

            // swap despawned particles to the end of the active list
            if (now - p.spawn_time >= lifetime_val::second) {
                0 => p.particle_mesh.sca;
                num_active--;
                particles[num_active] @=> particles[i];
                p @=> particles[num_active];
                i--;
                p.env.keyOff();
                continue;
            }

            // update particle
            {
                // update size (based on midi)
                Std.ftom(p.osc.freq()) => float midi;
                Math.remap(midi, 48, 74, 1, .3) => float size_factor;
                Math.pow((now - p.spawn_time) / lifetime_val::second, 2) => float t;
                size_factor * (1 - t) => p.particle_mesh.sca;

                // update color
                p.color + (end_color - p.color) * t => p.particle_mat.color;

                // update position
                (dt * p.direction).x => p.particle_mesh.translateX;
                (dt * p.direction).y => p.particle_mesh.translateY;
            }
        }
    }

    fun void spawnParticle(vec3 pos)
    {
        if (num_active < PARTICLE_POOL_SIZE) {
            particles[num_active] @=> Particle p;

            // audio mapping
            pitches[Math.random2(0, pitches.size()-1)] + 12 => int midi;
            Std.mtof(midi) => p.osc.freq;
            p.env.keyOn();

            // map color
            Math.remap(midi, 48, 74, 1, .3) => float color_factor;
            start_color + (end_color - start_color) * color_factor => p.particle_mat.color;
            p.particle_mat.color() => p.color;

            // set random direction
            Math.random2f(0, 2 * Math.PI) => float random_angle;
            @(Math.cos(random_angle), Math.sin(random_angle)) => p.direction;

            now => p.spawn_time;
            pos => p.particle_mesh.pos;
            num_active++;
        }
    }
}

// create a particle system
ParticleSystem ps;

// game loop
while (true)
{
    // synchronize
    GG.nextFrame() => now;

    // read HTML controls each frame
    @(bg_r, bg_g, bg_b) => bg_color;
    bg_color => GG.scene().backgroundColor;
    @(start_r, start_g, start_b) => start_color;
    @(end_r, end_g, end_b) => end_color;
    g_lifetime => lifetime_val;

    // apply blend mode on change
    if (g_blend_mode != prev_blend_mode) {
        g_blend_mode => prev_blend_mode;
        for (auto p : particles) {
            p.particle_mat.blend(g_blend_mode);
        }
    }

    // check for mouse input
    if (GWindow.mouseLeft()) {
        // spawn a particle at the mouse position
        ps.spawnParticle(GG.camera().screenCoordToWorldPos(GWindow.mousePos(), 1.0));
    }

    // update particle system
    ps.update(GG.dt());
}
